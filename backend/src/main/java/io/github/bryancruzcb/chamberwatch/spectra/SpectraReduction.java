package io.github.bryancruzcb.chamberwatch.spectra;

import java.util.List;
import java.util.Optional;
import java.util.SortedMap;
import java.util.TreeMap;

import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;
import io.github.bryancruzcb.chamberwatch.recipe.RecipeGrid;

/**
 * Turns one wafer's emission record into channels of its run: each line's mean in every 0.2 s slot the recipe
 * grid holds, on the run's own clock.
 *
 * <p>Three things happen here, in this order. The plasma is found in the spectra, which gives both the etch's
 * edges and the dark level each line reads with the plasma off; that dark level is subtracted, because the
 * detector carries a fixed pattern of its own that is half of a faint line's reading. The record is then lined up
 * with the run ({@link SpectraAlignment}). Finally the samples are averaged into the slots
 * ({@link SlotMeans}), and a slot that too few samples reached stays empty rather than storing one sample's noise
 * as though it were an average.
 *
 * <p>A calculation over the record and the run's slot times.
 */
public final class SpectraReduction {

	/** How many samples a 0.2 s slot needs before its mean is stored. The spectrometer gives about 4.7. */
	public static final int MINIMUM_SAMPLES = 2;

	/**
	 * How many of the slots inside the etch may stay empty before the wafer's record is judged too thin to store.
	 * A record with gaps makes a noisy slot mean, and a noisy slot mean inflates the phase spread the detectors
	 * learn from, which would turn a good wafer into a deviation on the strength of the spectrometer skipping.
	 */
	public static final double MAXIMUM_EMPTY_SHARE = 0.005;

	/**
	 * What the reduction did, whether or not it is worth storing.
	 *
	 * @param offsetS  what was added to the record's times to put it on the run's clock
	 * @param contrast how far the phases separated at that offset, in standard deviations
	 * @param assigned how many emission samples joined a slot
	 * @param dropped  how many fell outside every slot: before the etch, after it, or in a stretch the
	 *                 spectrometer skipped
	 * @param slots    how many slots inside the etch the reduction filled
	 * @param empty    how many slots inside the etch stayed empty
	 */
	public record Report(double offsetS, double contrast, int assigned, int dropped, int slots, int empty) {

		/** Whether the alignment held and the record covered the etch. */
		public boolean usable() {
			return contrast >= SpectraAlignment.MINIMUM_CONTRAST && slots > 0
					&& empty <= MAXIMUM_EMPTY_SHARE * (slots + empty);
		}

		public String describe() {
			return String.format("offset %+.3f s, contrast %.2f, %d samples in %d slots, %d empty, %d dropped",
					offsetS, contrast, assigned, slots, empty, dropped);
		}

	}

	/** A reduced wafer: one value per slot for each line, and what the reduction did. */
	public record Reduced(SortedMap<ChannelName, float[]> values, Report report) {
	}

	private SpectraReduction() {
	}

	/**
	 * @param spectra    the wafer's emission record
	 * @param slotTimes  the time the telemetry wrote for each slot of the run, NaN in a slot it never filled
	 * @param etchStartS where the aligner put the etch's start on the run's clock, the coarse guess the offset
	 *                   search starts from
	 * @return empty when the record holds no plasma to find, so there is nothing to place
	 */
	public static Optional<Reduced> reduce(WaferSpectra spectra, float[] slotTimes, RecipeGrid grid,
			double etchStartS) {
		Optional<PlasmaWindow> plasma = PlasmaWindow.find(spectra.line(EmissionLines.PLASMA), spectra.sinceStart());
		if (plasma.isEmpty()) {
			return Optional.empty();
		}
		PlasmaWindow window = plasma.get();
		float[][] dark = darkCorrected(spectra, window);
		double guess = etchStartS - spectra.sinceStart()[window.first()];
		Optional<SpectraAlignment.Offset> offset = SpectraAlignment.align(spectra.sinceStart(),
				dark[index(spectra, EmissionLines.PLASMA)], dark[index(spectra, EmissionLines.PASSIVATION)], window,
				slotTimes, grid, guess);
		if (offset.isEmpty()) {
			return Optional.empty();
		}
		List<EmissionLine> lines = spectra.lines();
		SlotMeans means = new SlotMeans(lines.size(), slotTimes, SpectraAlignment.TOLERANCE_S, MINIMUM_SAMPLES);
		int assigned = 0;
		float[] sample = new float[lines.size()];
		for (int at = window.first(); at <= window.last(); at++) {
			for (int line = 0; line < lines.size(); line++) {
				sample[line] = dark[line][at];
			}
			if (means.add(spectra.sinceStart()[at] + offset.get().seconds(), sample)) {
				assigned++;
			}
		}
		int[] perSlot = means.samplesPerSlot(0);
		List<float[]> reduced = means.finish();
		SortedMap<ChannelName, float[]> values = new TreeMap<>();
		for (int line = 0; line < lines.size(); line++) {
			values.put(lines.get(line).channel(), reduced.get(line));
		}
		int dropped = window.samples() - assigned;
		return Optional.of(new Reduced(values,
				coverage(offset.get(), assigned, dropped, perSlot, reduced.get(0), slotTimes)));
	}

	/** Each line's readings with its own plasma-off level subtracted, so the detector's fixed pattern goes too. */
	private static float[][] darkCorrected(WaferSpectra spectra, PlasmaWindow window) {
		float[][] corrected = new float[spectra.lines().size()][];
		for (int line = 0; line < spectra.lines().size(); line++) {
			float[] raw = spectra.values()[line];
			double dark = 0;
			int darkSamples = 0;
			for (int at = 0; at < window.first(); at++) {
				dark += raw[at];
				darkSamples++;
			}
			double level = (darkSamples == 0) ? 0 : dark / darkSamples;
			float[] values = new float[raw.length];
			for (int at = 0; at < raw.length; at++) {
				values[at] = (float) (raw[at] - level);
			}
			corrected[line] = values;
		}
		return corrected;
	}

	/**
	 * The slots between the first and the last the reduction reached, and how many of them stayed empty. Only slots
	 * the telemetry itself filled are counted: a slot with no telemetry sample is the recipe's own gap, not a gap in
	 * the emission record.
	 */
	private static Report coverage(SpectraAlignment.Offset offset, int assigned, int dropped, int[] perSlot,
			float[] values, float[] slotTimes) {
		int first = -1;
		int last = -1;
		for (int slot = 0; slot < perSlot.length; slot++) {
			if (perSlot[slot] > 0) {
				first = (first < 0) ? slot : first;
				last = slot;
			}
		}
		int filled = 0;
		int empty = 0;
		for (int slot = first; slot >= 0 && slot <= last; slot++) {
			if (Float.isNaN(slotTimes[slot])) {
				continue;
			}
			if (Float.isNaN(values[slot])) {
				empty++;
			}
			else {
				filled++;
			}
		}
		return new Report(offset.seconds(), offset.contrast(), assigned, dropped, filled, empty);
	}

	private static int index(WaferSpectra spectra, ChannelName channel) {
		for (int at = 0; at < spectra.lines().size(); at++) {
			if (spectra.lines().get(at).channel().equals(channel)) {
				return at;
			}
		}
		throw new IllegalArgumentException("the reduction needs " + channel.value() + " to place the record");
	}

}
