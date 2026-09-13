package io.github.bryancruzcb.chamberwatch.recipe;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;

/**
 * Gives every sample of a run a slot on the recipe grid, once per run. Pure and stateless.
 *
 * <p>Only gas stretches at etch power count, so the gas steps of a plasma strike, which run near 140
 * instead of 2,790, are never mistaken for etch phases. C4F8 phases anchor the cycles, because the
 * first SF6 phase varies between wafers. Cycle k's SF6 onset is the first SF6 stretch after C4F8 phase
 * k-1, so a dip inside an SF6 phase cannot move it. When a marker is missing, because a flow is stuck,
 * a sensor dropped out or the record has a gap, the aligner keeps walking the cycles at the measured
 * rhythm and counts the onset as predicted. The walk ends when no etch phase follows.
 */
public final class Aligner {

	/** Stored with every run. Bump it whenever the grid or this algorithm changes. */
	public static final int VERSION = 1;

	public static final Aligner STANDARD = new Aligner(RecipeGrid.STANDARD, MarkerRules.STANDARD);

	private static final double EPSILON = 1e-6;

	private final RecipeGrid grid;

	private final MarkerRules rules;

	public Aligner(RecipeGrid grid, MarkerRules rules) {
		this.grid = grid;
		this.rules = rules;
	}

	public RecipeGrid grid() {
		return grid;
	}

	/** Never throws for bad data: a run that cannot be aligned becomes {@link AlignmentResult.Failed}. */
	public AlignmentResult align(RawRun raw) {
		int sf6Marker = raw.channels().indexOf(rules.sf6Marker());
		int c4f8Marker = raw.channels().indexOf(rules.c4f8Marker());
		int powerMarker = raw.channels().indexOf(rules.powerMarker());
		for (ChannelName marker : List.of(rules.sf6Marker(), rules.c4f8Marker(), rules.powerMarker())) {
			if (!raw.channels().contains(marker)) {
				return new AlignmentResult.Failed(raw.key(), "marker channel missing: " + marker, raw.sampleCount());
			}
		}
		int samples = raw.sampleCount();
		double[] times = new double[samples];
		boolean[] sf6On = new boolean[samples];
		boolean[] c4f8On = new boolean[samples];
		boolean[] hot = new boolean[samples];
		for (int i = 0; i < samples; i++) {
			times[i] = raw.time(i);
			sf6On[i] = raw.value(sf6Marker, i) >= rules.sf6OnLevel();
			c4f8On[i] = !sf6On[i] && raw.value(c4f8Marker, i) >= rules.c4f8OnLevel();
			hot[i] = raw.value(powerMarker, i) >= rules.powerOnLevel();
		}
		List<Stretch> sf6Stretches = stretches(sf6On, hot, times).stream()
			.filter((stretch) -> stretch.samples() >= rules.sf6MinSamples())
			.filter((stretch) -> stretch.hotFraction() >= rules.minHotFraction())
			.toList();
		List<Stretch> c4f8Phases = stretches(c4f8On, hot, times).stream()
			.filter((stretch) -> rules.c4f8Seconds().contains(stretch.durationS(grid.slotSeconds())))
			.filter((stretch) -> stretch.hotFraction() >= rules.minHotFraction())
			.toList();
		if (c4f8Phases.isEmpty()) {
			return new AlignmentResult.Failed(raw.key(), "no C4F8 phase at etch power", samples);
		}
		return new AlignmentResult.Aligned(fill(raw, times, sf6Stretches, c4f8Phases, walk(sf6Stretches, c4f8Phases)));
	}

	/** Finds every onset in time order: [SF6 1], C4F8 1, SF6 2, C4F8 2, and so on until no etch phase follows. */
	private Onsets walk(List<Stretch> sf6Stretches, List<Stretch> c4f8Phases) {
		int cycles = grid.cycles();
		double[] sf6 = new double[cycles + 1];
		boolean[] sf6Seen = new boolean[cycles + 1];
		double[] c4f8 = new double[cycles];
		boolean[] c4f8Seen = new boolean[cycles];
		Arrays.fill(sf6, Double.NaN);
		Arrays.fill(c4f8, Double.NaN);
		List<Double> sf6ToC4f8 = new ArrayList<>();
		List<Double> c4f8ToSf6 = new ArrayList<>();

		c4f8[1] = c4f8Phases.get(0).startS();
		c4f8Seen[1] = true;
		for (Stretch stretch : sf6Stretches) {
			double lead = c4f8[1] - stretch.endS(grid.slotSeconds());
			if (lead >= -EPSILON && lead <= rules.cycle1LeadGapS() + EPSILON) {
				sf6[1] = stretch.startS();
				sf6Seen[1] = true;
			}
		}
		Tally tally = new Tally();
		tally.seen();
		int lastCycle = 1;
		boolean endsWithSf6 = false;
		int nextSf6 = 0;
		int nextC4f8 = 1;
		for (int cycle = 2; cycle <= cycles; cycle++) {
			if (!anyStartsAfter(sf6Stretches, c4f8Phases, c4f8[cycle - 1])) {
				break;
			}
			double expectedSf6 = c4f8[cycle - 1] + median(c4f8ToSf6, rules.initialC4f8ToSf6S());
			while (nextSf6 < sf6Stretches.size() && sf6Stretches.get(nextSf6).startS() <= c4f8[cycle - 1] + EPSILON) {
				nextSf6++;
			}
			if (nextSf6 < sf6Stretches.size() && accepts(sf6Stretches.get(nextSf6), expectedSf6)) {
				sf6[cycle] = sf6Stretches.get(nextSf6).startS();
				sf6Seen[cycle] = true;
				tally.seen();
				if (c4f8Seen[cycle - 1]) {
					c4f8ToSf6.add(sf6[cycle] - c4f8[cycle - 1]);
				}
			}
			else {
				sf6[cycle] = expectedSf6;
				tally.predicted(cycle);
			}
			lastCycle = cycle;
			endsWithSf6 = true;
			if (cycle == cycles || !anyStartsAfter(sf6Stretches, c4f8Phases, sf6[cycle])) {
				break;
			}
			double expectedC4f8 = sf6[cycle] + median(sf6ToC4f8, rules.initialSf6ToC4f8S());
			while (nextC4f8 < c4f8Phases.size() && c4f8Phases.get(nextC4f8).startS() <= sf6[cycle] + EPSILON) {
				nextC4f8++;
			}
			if (nextC4f8 < c4f8Phases.size() && accepts(c4f8Phases.get(nextC4f8), expectedC4f8)) {
				c4f8[cycle] = c4f8Phases.get(nextC4f8).startS();
				c4f8Seen[cycle] = true;
				tally.seen();
				if (sf6Seen[cycle]) {
					sf6ToC4f8.add(c4f8[cycle] - sf6[cycle]);
				}
				nextC4f8++;
			}
			else {
				c4f8[cycle] = expectedC4f8;
				tally.predicted(cycle);
			}
			endsWithSf6 = false;
		}
		return new Onsets(sf6, sf6Seen, c4f8, c4f8Seen, lastCycle, endsWithSf6, tally);
	}

	private static boolean anyStartsAfter(List<Stretch> sf6Stretches, List<Stretch> c4f8Phases, double timeS) {
		return startsAfter(sf6Stretches, timeS) || startsAfter(c4f8Phases, timeS);
	}

	private static boolean startsAfter(List<Stretch> sortedStretches, double timeS) {
		return !sortedStretches.isEmpty() && sortedStretches.get(sortedStretches.size() - 1).startS() > timeS + EPSILON;
	}

	/** A stretch that starts right after a recording gap may have lost its real onset, so it never counts as seen. */
	private boolean accepts(Stretch stretch, double expectedS) {
		return !stretch.afterGap() && Math.abs(stretch.startS() - expectedS) <= rules.lockWindowS() + EPSILON;
	}

	private AlignedRun fill(RawRun raw, double[] times, List<Stretch> sf6Stretches, List<Stretch> c4f8Phases,
			Onsets onsets) {
		List<Window> windows = new ArrayList<>(2 * onsets.lastCycle());
		if (onsets.sf6Seen()[1]) {
			windows.add(new Window(1, Phase.SF6, onsets.sf6()[1]));
		}
		for (int cycle = 1; cycle <= onsets.lastCycle(); cycle++) {
			if (cycle >= 2) {
				windows.add(new Window(cycle, Phase.SF6, onsets.sf6()[cycle]));
			}
			if (cycle < onsets.lastCycle() || !onsets.endsWithSf6()) {
				windows.add(new Window(cycle, Phase.C4F8, onsets.c4f8()[cycle]));
			}
		}
		double etchStartS = windows.get(0).onsetS();
		double etchEndS = etchEnd(windows.get(windows.size() - 1), sf6Stretches, c4f8Phases, onsets);

		int slotCount = grid.slotCount();
		int channels = raw.channels().size();
		float[] slotTimes = new float[slotCount];
		float[] values = new float[channels * slotCount];
		Arrays.fill(slotTimes, Float.NaN);
		Arrays.fill(values, Float.NaN);
		int preEtch = 0;
		int postEtch = 0;
		int steadyOverflow = 0;
		int edgeOverflow = 0;
		int collisions = 0;
		int window = 0;
		for (int i = 0; i < times.length; i++) {
			double time = times[i];
			if (time < etchStartS) {
				preEtch++;
				continue;
			}
			if (time >= etchEndS) {
				postEtch++;
				continue;
			}
			while (window + 1 < windows.size() && time >= windows.get(window + 1).onsetS()) {
				window++;
			}
			Window current = windows.get(window);
			int offset = (int) Math.floor((time - current.onsetS()) / grid.slotSeconds() + 0.5);
			if (offset >= grid.capacity(current.phase())) {
				if (grid.isSteady(current.cycle())) {
					steadyOverflow++;
				}
				else {
					edgeOverflow++;
				}
				continue;
			}
			int slot = grid.slot(current.cycle(), current.phase(), offset);
			if (!Float.isNaN(slotTimes[slot])) {
				collisions++;
				double centre = current.onsetS() + offset * grid.slotSeconds();
				if (Math.abs(time - centre) >= Math.abs(slotTimes[slot] - centre)) {
					continue;
				}
			}
			slotTimes[slot] = (float) time;
			for (int channel = 0; channel < channels; channel++) {
				values[channel * slotCount + slot] = raw.value(channel, i);
			}
		}

		Optional<AlignmentReport.Gap> largestGap = Optional.empty();
		boolean gapInsideEtch = false;
		for (int i = 1; i < times.length; i++) {
			double step = times[i] - times[i - 1];
			if (step <= grid.gapStepSeconds()) {
				continue;
			}
			boolean inside = times[i - 1] < etchEndS && times[i] > etchStartS;
			gapInsideEtch |= inside;
			if (largestGap.isEmpty() || step > largestGap.get().lengthS()) {
				largestGap = Optional.of(new AlignmentReport.Gap(times[i - 1], step, inside));
			}
		}

		List<Integer> irregular = new ArrayList<>();
		for (int cycle = 2; cycle < onsets.lastCycle(); cycle++) {
			if (grid.isSteady(cycle) && onsets.sf6Seen()[cycle] && onsets.c4f8Seen()[cycle]
					&& onsets.sf6Seen()[cycle + 1]
					&& (!rules.regularSf6ToC4f8S().contains(onsets.c4f8()[cycle] - onsets.sf6()[cycle])
							|| !rules.regularC4f8ToSf6S().contains(onsets.sf6()[cycle + 1] - onsets.c4f8()[cycle]))) {
				irregular.add(cycle);
			}
		}

		Tally tally = onsets.tally();
		Optional<String> note = Optional.empty();
		if (tally.predicted > 0) {
			note = Optional.of(tally.predicted + " phase onsets predicted, the first in cycle " + tally.firstPredictedCycle);
		}
		else if (gapInsideEtch) {
			note = Optional.of("recording gap inside the etch");
		}
		else if (steadyOverflow > 0) {
			note = Optional.of(steadyOverflow + " samples past a phase's slot capacity in steady cycles");
		}
		AlignmentStatus status = note.isPresent() ? AlignmentStatus.DEGRADED : AlignmentStatus.ALIGNED;
		AlignmentReport report = new AlignmentReport(status, note, times.length, etchStartS, etchEndS,
				onsets.sf6Seen()[1], c4f8Phases.size(), onsets.lastCycle(), tally.seen, tally.predicted, largestGap,
				preEtch, postEtch, steadyOverflow, edgeOverflow, collisions, irregular);
		return AlignedRun.adopt(raw.key(), grid, raw.channels(), values, slotTimes, report);
	}

	/** The last phase ends when its flow drops, plus trailing samples. A predicted one fills its capacity. */
	private double etchEnd(Window last, List<Stretch> sf6Stretches, List<Stretch> c4f8Phases, Onsets onsets) {
		boolean seen = (last.phase() == Phase.SF6) ? onsets.sf6Seen()[last.cycle()] : onsets.c4f8Seen()[last.cycle()];
		double capacityEnd = last.onsetS() + grid.capacity(last.phase()) * grid.slotSeconds();
		if (!seen) {
			return capacityEnd;
		}
		double end = last.onsetS();
		for (Stretch stretch : (last.phase() == Phase.SF6) ? sf6Stretches : c4f8Phases) {
			if (stretch.startS() >= last.onsetS() - EPSILON && stretch.startS() < capacityEnd) {
				end = Math.max(end, stretch.lastS() + (rules.trailingSamples() + 0.5) * grid.slotSeconds());
			}
		}
		return end;
	}

	private List<Stretch> stretches(boolean[] on, boolean[] hot, double[] times) {
		List<Stretch> stretches = new ArrayList<>();
		int i = 0;
		while (i < on.length) {
			if (!on[i]) {
				i++;
				continue;
			}
			int j = i + 1;
			while (j < on.length && on[j] && times[j] - times[j - 1] <= grid.gapStepSeconds()) {
				j++;
			}
			int hotSamples = 0;
			for (int k = i; k < j; k++) {
				if (hot[k]) {
					hotSamples++;
				}
			}
			boolean afterGap = i > 0 && times[i] - times[i - 1] > grid.gapStepSeconds();
			stretches.add(new Stretch(times[i], times[j - 1], j - i, (double) hotSamples / (j - i), afterGap));
			i = j;
		}
		return stretches;
	}

	private double median(List<Double> intervals, double fallback) {
		if (intervals.isEmpty()) {
			return fallback;
		}
		double[] recent = intervals.subList(Math.max(0, intervals.size() - rules.medianOf()), intervals.size())
			.stream()
			.mapToDouble(Double::doubleValue)
			.sorted()
			.toArray();
		int middle = recent.length / 2;
		return (recent.length % 2 == 1) ? recent[middle] : (recent[middle - 1] + recent[middle]) / 2;
	}

	/** Consecutive samples with a gas marker on, split at recording gaps. */
	private record Stretch(double startS, double lastS, int samples, double hotFraction, boolean afterGap) {

		double durationS(double slotSeconds) {
			return lastS - startS + slotSeconds;
		}

		double endS(double slotSeconds) {
			return lastS + slotSeconds;
		}

	}

	/**
	 * Onset times by cycle, index 0 unused. {@code sf6[1]} is NaN when the etch starts with C4F8, and
	 * nothing after {@code lastCycle} is set.
	 */
	private record Onsets(double[] sf6, boolean[] sf6Seen, double[] c4f8, boolean[] c4f8Seen, int lastCycle,
			boolean endsWithSf6, Tally tally) {
	}

	/** Counts of onsets seen and predicted during the walk, not counting cycle 1's optional SF6 onset. */
	private static final class Tally {

		private int seen;

		private int predicted;

		private int firstPredictedCycle;

		void seen() {
			seen++;
		}

		void predicted(int cycle) {
			predicted++;
			if (firstPredictedCycle == 0) {
				firstPredictedCycle = cycle;
			}
		}

	}

	/** The span from one phase onset to the next. */
	private record Window(int cycle, Phase phase, double onsetS) {
	}

}
