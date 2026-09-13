package io.github.bryancruzcb.chamberwatch.detect;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.SortedMap;
import java.util.SortedSet;
import java.util.TreeMap;
import java.util.TreeSet;

import io.github.bryancruzcb.chamberwatch.recipe.AlignedRun;
import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;
import io.github.bryancruzcb.chamberwatch.recipe.Phase;
import io.github.bryancruzcb.chamberwatch.recipe.PhaseSummary;
import io.github.bryancruzcb.chamberwatch.recipe.RecipeGrid;
import io.github.bryancruzcb.chamberwatch.recipe.RecipePosition;
import io.github.bryancruzcb.chamberwatch.recipe.RunKey;

/**
 * Learns a baseline from good runs one run at a time. It keeps a count, a sum and a sum of squares
 * per channel and slot, so memory does not grow with the number of good runs. Single use: add runs,
 * then finish once.
 */
final class BaselineFitter {

	private final RecipeGrid grid;

	private final DetectorConfig config;

	private final SortedMap<ChannelName, Accumulator> channels = new TreeMap<>();

	private final SortedSet<RunKey> goodRuns = new TreeSet<>();

	BaselineFitter(RecipeGrid grid, DetectorConfig config) {
		this.grid = grid;
		this.config = config;
	}

	void add(AlignedRun run) {
		if (!run.grid().equals(grid)) {
			throw new IllegalArgumentException(run.key().value() + " is on a different grid");
		}
		if (!goodRuns.add(run.key())) {
			throw new IllegalArgumentException(run.key().value() + " was added twice");
		}
		Map<ChannelName, List<PhaseSummary>> summaries = new HashMap<>();
		for (PhaseSummary summary : run.summaries()) {
			summaries.computeIfAbsent(summary.channel(), (name) -> new ArrayList<>()).add(summary);
		}
		// A run whose etch ends before cycle 100 ends it with the longer final SF6 phase, so its last
		// cycle stays out of the steady bands.
		boolean[] linesUp = new boolean[grid.slotCount()];
		for (int slot = 0; slot < grid.slotCount(); slot++) {
			int cycle = grid.cycleOf(slot);
			linesUp[slot] = !grid.isSteady(cycle) || run.isScored(cycle);
		}
		for (int channel = 0; channel < run.channels().size(); channel++) {
			ChannelName name = run.channels().name(channel);
			Accumulator accumulator = channels.computeIfAbsent(name,
					(ignored) -> new Accumulator(grid.slotCount(), config.band().maxDistinctTracked()));
			accumulator.runs++;
			for (int slot = 0; slot < grid.slotCount(); slot++) {
				float value = run.value(channel, slot);
				if (linesUp[slot] && !Float.isNaN(value)) {
					accumulator.add(slot, value);
				}
			}
			for (PhaseSummary summary : summaries.getOrDefault(name, List.of())) {
				for (SummaryStat stat : SummaryStat.values()) {
					accumulator.summary(summary.phase(), stat).add(stat.of(summary));
				}
			}
		}
	}

	Baseline finish() {
		if (goodRuns.isEmpty()) {
			throw new IllegalStateException("a baseline needs at least one good run");
		}
		Map<ChannelName, ChannelBand> bands = new TreeMap<>();
		Map<SummaryBands.Key, SummaryBand> summaryBands = new HashMap<>();
		for (Map.Entry<ChannelName, Accumulator> entry : channels.entrySet()) {
			ChannelName name = entry.getKey();
			Accumulator accumulator = entry.getValue();
			float[] mean = new float[grid.slotCount()];
			float[] sd = new float[grid.slotCount()];
			Arrays.fill(mean, Float.NaN);
			Arrays.fill(sd, Float.NaN);
			for (int slot = 0; slot < grid.slotCount(); slot++) {
				if (accumulator.n[slot] > 0) {
					mean[slot] = (float) (accumulator.sum[slot] / accumulator.n[slot]);
				}
			}
			boolean constant = !(accumulator.max > accumulator.min);
			if (!constant) {
				double resolution = accumulator.resolution();
				double[] pooled = pooledSd(accumulator);
				double floor = Math.max(config.band().relativeSdFloor() * median(pooled), resolution);
				for (int slot = 0; slot < grid.slotCount(); slot++) {
					double floored = Math.max(pooled[slot], floor);
					if (Double.isFinite(pooled[slot]) && floored > 0) {
						sd[slot] = (float) floored;
					}
				}
				for (Phase phase : Phase.values()) {
					for (SummaryStat stat : SummaryStat.values()) {
						List<Double> values = accumulator.summary(phase, stat);
						if (values.size() >= 2) {
							summaryBands.put(new SummaryBands.Key(name, phase, stat), summaryBand(values, resolution));
						}
					}
				}
			}
			bands.put(name, ChannelBand.adopt(name, constant ? ChannelRole.CONSTANT : ChannelRole.INFORMATIVE,
					accumulator.runs, mean, sd));
		}
		return Baseline.adopt(grid, config, goodRuns, bands, SummaryBands.of(summaryBands));
	}

	/**
	 * The sd at each slot, pooled over the same phase and offset in the neighbouring steady cycles.
	 * Cycles 1 and 100 are not pooled, because their phases differ between wafers. NaN where no good run
	 * filled the slot itself, since a band needs the slot's own mean, and where the pooled observations
	 * fall short of the minimum.
	 */
	private double[] pooledSd(Accumulator accumulator) {
		int halfWidth = config.band().poolHalfWidthCycles();
		double[] pooled = new double[grid.slotCount()];
		Arrays.fill(pooled, Double.NaN);
		for (int slot = 0; slot < grid.slotCount(); slot++) {
			if (accumulator.n[slot] == 0) {
				continue;
			}
			RecipePosition position = grid.position(slot);
			boolean steady = grid.isSteady(position.cycle());
			int from = steady ? Math.max(2, position.cycle() - halfWidth) : position.cycle();
			int to = steady ? Math.min(grid.cycles() - 1, position.cycle() + halfWidth) : position.cycle();
			double weightedVariance = 0;
			long degreesOfFreedom = 0;
			long observations = 0;
			for (int cycle = from; cycle <= to; cycle++) {
				int neighbour = grid.slot(cycle, position.phase(), position.offset());
				int n = accumulator.n[neighbour];
				observations += n;
				if (n >= 2) {
					double mean = accumulator.sum[neighbour] / n;
					double variance = Math.max(0, (accumulator.sumOfSquares[neighbour] - n * mean * mean) / (n - 1));
					weightedVariance += (n - 1) * variance;
					degreesOfFreedom += n - 1;
				}
			}
			if (observations >= config.band().minObservations() && degreesOfFreedom > 0) {
				pooled[slot] = Math.sqrt(weightedVariance / degreesOfFreedom);
			}
		}
		return pooled;
	}

	private static SummaryBand summaryBand(List<Double> values, double resolution) {
		double mean = values.stream().mapToDouble(Double::doubleValue).average().orElseThrow();
		double squares = values.stream().mapToDouble((value) -> (value - mean) * (value - mean)).sum();
		double sd = Math.sqrt(squares / (values.size() - 1));
		double floor = Math.max(resolution, 1e-9 * Math.max(1, Math.abs(mean)));
		return new SummaryBand(mean, Math.max(sd, floor));
	}

	private static double median(double[] values) {
		double[] finite = Arrays.stream(values).filter(Double::isFinite).sorted().toArray();
		if (finite.length == 0) {
			return 0;
		}
		int middle = finite.length / 2;
		return (finite.length % 2 == 1) ? finite[middle] : (finite[middle - 1] + finite[middle]) / 2;
	}

	private static final class Accumulator {

		private final int[] n;

		private final double[] sum;

		private final double[] sumOfSquares;

		private final int maxDistinct;

		private final Map<Phase, Map<SummaryStat, List<Double>>> summaries = new EnumMap<>(Phase.class);

		private TreeSet<Float> distinct = new TreeSet<>();

		private float min = Float.POSITIVE_INFINITY;

		private float max = Float.NEGATIVE_INFINITY;

		private int runs;

		Accumulator(int slots, int maxDistinct) {
			this.n = new int[slots];
			this.sum = new double[slots];
			this.sumOfSquares = new double[slots];
			this.maxDistinct = maxDistinct;
		}

		void add(int slot, float value) {
			n[slot]++;
			sum[slot] += value;
			sumOfSquares[slot] += (double) value * value;
			min = Math.min(min, value);
			max = Math.max(max, value);
			if (distinct != null) {
				distinct.add(value);
				if (distinct.size() > maxDistinct) {
					distinct = null;
				}
			}
		}

		/** The smallest gap between distinct good-run values, or 0 when too many values were seen to tell. */
		double resolution() {
			if (distinct == null || distinct.size() < 2) {
				return 0;
			}
			double smallest = Double.POSITIVE_INFINITY;
			Float previous = null;
			for (Float value : distinct) {
				if (previous != null) {
					smallest = Math.min(smallest, value - previous);
				}
				previous = value;
			}
			return smallest;
		}

		List<Double> summary(Phase phase, SummaryStat stat) {
			return summaries.computeIfAbsent(phase, (ignored) -> new EnumMap<>(SummaryStat.class))
				.computeIfAbsent(stat, (ignored) -> new ArrayList<>());
		}

	}

}
