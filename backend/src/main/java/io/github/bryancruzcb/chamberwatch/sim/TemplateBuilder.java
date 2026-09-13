package io.github.bryancruzcb.chamberwatch.sim;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalDouble;
import java.util.SortedSet;
import java.util.TreeMap;
import java.util.TreeSet;

import io.github.bryancruzcb.chamberwatch.recipe.AlignedRun;
import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;
import io.github.bryancruzcb.chamberwatch.recipe.Phase;
import io.github.bryancruzcb.chamberwatch.recipe.RawRun;
import io.github.bryancruzcb.chamberwatch.recipe.RecipeGrid;

/**
 * Measures a {@link SimulationTemplate} from aligned public wafers. For every channel and phase it splits
 * the variation into the parts the simulator draws separately: a lot level, a run level around the lot's
 * line along wafer position, slow wander from cycle to cycle, fast noise from sample to sample, and the
 * occasional swing, a few cycles far from the run's level.
 *
 * <p>A cycle's level is the median distance of its core readings from the phase's average shape, so neither
 * a one-sample dip nor the shape itself moves it. Core offsets are ones nearly every steady cycle fills,
 * clear of the phase edges. The shape, trend, wander, noise and swings come from good runs; the lot and run
 * levels and the drift come from every wafer, since drift only shows past the good runs.
 */
public final class TemplateBuilder {

	/** SF6 offsets 1 to 20 and C4F8 offsets 1 to 4. */
	static final int[][] CORE = { { 1, 20 }, { 1, 4 } };

	/** A cycle this many typical cycle spreads from its run's level starts or extends a swing. */
	static final double SWING_THRESHOLD = 5;

	/** A swing also has to span this many resolution steps, so one step of a coarse channel never counts. */
	static final double SWING_MIN_STEPS = 3;

	/** Readings taken as the pre-etch idle level: the first samples of each record. */
	private static final int IDLE_SAMPLES = 20;

	private static final int MAX_DISTINCT = 4096;

	/** Residuals kept when trimming, and what a normal sample's root mean square is scaled by after that trim. */
	private static final double KEEP = 0.98;

	private static final double TRIM_CORRECTION = 1.0700;

	private TemplateBuilder() {
	}

	/** One public wafer as recorded and as aligned. */
	public record Wafer(RawRun raw, AlignedRun run) {
	}

	/**
	 * @param goodRunsPerLot wafers 1 to this in each lot are the good runs
	 * @throws IllegalArgumentException when there are no good runs
	 */
	public static SimulationTemplate build(List<Wafer> wafers, int goodRunsPerLot) {
		List<Wafer> good = wafers.stream().filter((wafer) -> wafer.run().key().positionInLot() <= goodRunsPerLot).toList();
		if (good.isEmpty()) {
			throw new IllegalArgumentException("a template needs good runs");
		}
		SortedSet<ChannelName> shared = new TreeSet<>(wafers.get(0).run().channels().names());
		wafers.forEach((wafer) -> shared.retainAll(wafer.run().channels().names()));
		List<ChannelTemplate> channels = new ArrayList<>();
		List<SimulationTemplate.Swing> swings = new ArrayList<>();
		for (ChannelName channel : shared) {
			channels.add(channel(channel, wafers, good, swings));
		}
		return SimulationTemplate.of(channels, new SimulationTemplate.Swings(good.size(), swings));
	}

	/**
	 * The spread of one reading across runs that a phase template implies: lot, run, wander and noise together,
	 * close to what a band learns. Swings are measured in it, so a swing moves a reading by about its size in
	 * band standard deviations on any channel.
	 */
	static double bandSd(ChannelTemplate.PhaseTemplate template) {
		return Math.sqrt(template.lotSd() * template.lotSd() + template.runSd() * template.runSd()
				+ template.wanderSd() * template.wanderSd() + template.noiseSd() * template.noiseSd());
	}

	/** The variance of the mean of n AR(1) readings with unit variance and lag-1 correlation rho. */
	static double meanVarianceFactor(int n, double rho) {
		double sum = 1;
		double power = 1;
		for (int lag = 1; lag < n; lag++) {
			power *= rho;
			sum += 2 * (1 - (double) lag / n) * power;
		}
		return sum / n;
	}

	private static ChannelTemplate channel(ChannelName channel, List<Wafer> wafers, List<Wafer> good,
			List<SimulationTemplate.Swing> swings) {
		RecipeGrid grid = RecipeGrid.STANDARD;
		float min = Float.POSITIVE_INFINITY;
		float max = Float.NEGATIVE_INFINITY;
		TreeSet<Float> distinct = new TreeSet<>();
		for (Wafer wafer : good) {
			int index = wafer.run().channels().indexOf(channel);
			for (int slot = 0; slot < grid.slotCount(); slot++) {
				float value = wafer.run().value(index, slot);
				if (!wafer.run().isScored(grid.cycleOf(slot)) || Float.isNaN(value)) {
					continue;
				}
				min = Math.min(min, value);
				max = Math.max(max, value);
				if (distinct != null && distinct.add(value) && distinct.size() > MAX_DISTINCT) {
					distinct = null;
				}
			}
		}
		boolean nonNegative = true;
		for (Wafer wafer : wafers) {
			int index = wafer.raw().channels().indexOf(channel);
			for (int sample = 0; sample < wafer.raw().sampleCount(); sample++) {
				nonNegative &= wafer.raw().value(index, sample) >= 0;
			}
		}
		double[] idle = new double[good.size()];
		for (int i = 0; i < good.size(); i++) {
			RawRun raw = good.get(i).raw();
			int index = raw.channels().indexOf(channel);
			double[] first = new double[Math.min(IDLE_SAMPLES, raw.sampleCount())];
			for (int sample = 0; sample < first.length; sample++) {
				first[sample] = raw.value(index, sample);
			}
			idle[i] = median(first);
		}
		double resolution = resolution(distinct);
		if (!(max > min)) {
			return new ChannelTemplate(channel, OptionalDouble.of(min), median(idle), resolution, nonNegative, 0, 0,
					Optional.empty(), Optional.empty());
		}
		PhaseFit sf6 = phase(channel, Phase.SF6, wafers, good, resolution);
		PhaseFit c4f8 = phase(channel, Phase.C4F8, wafers, good, resolution);
		// swings are counted on the longer SF6 phase, and the simulator applies each to both phases
		swings.addAll(sf6.swings());
		return new ChannelTemplate(channel, OptionalDouble.empty(), median(idle), resolution, nonNegative, sf6.noiseRho(),
				sf6.wanderPhi(), Optional.of(sf6.template()), Optional.of(c4f8.template()));
	}

	private record PhaseFit(ChannelTemplate.PhaseTemplate template, double noiseRho, double wanderPhi,
			List<SimulationTemplate.Swing> swings) {
	}

	private static PhaseFit phase(ChannelName channel, Phase phase, List<Wafer> wafers, List<Wafer> good,
			double resolution) {
		RecipeGrid grid = RecipeGrid.STANDARD;
		int coreFrom = CORE[phase.ordinal()][0];
		int coreTo = CORE[phase.ordinal()][1];
		int coreSize = coreTo - coreFrom + 1;
		int cycles = grid.cycles();

		// the phase's average shape over steady cycles of good runs
		double[] profile = new double[grid.capacity(phase)];
		for (int offset = 0; offset < profile.length; offset++) {
			double sum = 0;
			int counted = 0;
			for (Wafer wafer : good) {
				int index = wafer.run().channels().indexOf(channel);
				for (int cycle = 1; cycle <= cycles; cycle++) {
					if (!wafer.run().isScored(cycle)) {
						continue;
					}
					float value = wafer.run().value(index, grid.slot(cycle, phase, offset));
					if (!Float.isNaN(value)) {
						sum += value;
						counted++;
					}
				}
			}
			profile[offset] = (counted > 0) ? sum / counted : Double.NaN;
		}
		fillFromNeighbours(profile);
		double coreLevel = 0;
		for (int offset = coreFrom; offset <= coreTo; offset++) {
			coreLevel += profile[offset];
		}
		coreLevel /= coreSize;

		// each cycle's level, and each run's level as the mean of its cycles
		Map<Wafer, double[]> cycleLevels = new HashMap<>();
		Map<Wafer, Double> runLevels = new HashMap<>();
		double[] deviations = new double[coreSize];
		for (Wafer wafer : wafers) {
			AlignedRun run = wafer.run();
			int index = run.channels().indexOf(channel);
			double[] levels = new double[cycles + 1];
			Arrays.fill(levels, Double.NaN);
			double sum = 0;
			int counted = 0;
			for (int cycle = 1; cycle <= cycles; cycle++) {
				if (!run.isScored(cycle)) {
					continue;
				}
				int present = 0;
				for (int offset = coreFrom; offset <= coreTo; offset++) {
					float value = run.value(index, grid.slot(cycle, phase, offset));
					if (!Float.isNaN(value)) {
						deviations[present++] = value - profile[offset];
					}
				}
				if (present * 2 >= coreSize) {
					levels[cycle] = coreLevel + median(Arrays.copyOf(deviations, present));
					sum += levels[cycle];
					counted++;
				}
			}
			cycleLevels.put(wafer, levels);
			runLevels.put(wafer, sum / counted);
		}

		double[] trend = new double[cycles + 1];
		Arrays.fill(trend, Double.NaN);
		for (int cycle = 2; cycle < cycles; cycle++) {
			double sum = 0;
			int counted = 0;
			for (Wafer wafer : good) {
				double level = cycleLevels.get(wafer)[cycle];
				if (!Double.isNaN(level)) {
					sum += level - runLevels.get(wafer);
					counted++;
				}
			}
			if (counted > 0) {
				trend[cycle] = sum / counted;
			}
		}
		double[] cycleTrend = withEdges(trend);

		// lot level at wafer 2, drift per position, and the residual run level, from every wafer
		Map<LocalDate, List<Wafer>> lots = new TreeMap<>();
		wafers.forEach((wafer) -> lots.computeIfAbsent(wafer.run().key().day().orElseThrow(), (day) -> new ArrayList<>())
			.add(wafer));
		double[] lotLevels = new double[lots.size()];
		double[] drifts = new double[lots.size()];
		double squaredResiduals = 0;
		int lot = 0;
		for (List<Wafer> members : lots.values()) {
			double positionMean = members.stream().mapToDouble((w) -> w.run().key().positionInLot() - 2).average().orElseThrow();
			double levelMean = members.stream().mapToDouble(runLevels::get).average().orElseThrow();
			double sxx = 0;
			double sxy = 0;
			for (Wafer wafer : members) {
				double x = wafer.run().key().positionInLot() - 2 - positionMean;
				sxx += x * x;
				sxy += x * (runLevels.get(wafer) - levelMean);
			}
			drifts[lot] = sxy / sxx;
			lotLevels[lot] = levelMean - drifts[lot] * positionMean;
			for (Wafer wafer : members) {
				double fitted = lotLevels[lot] + drifts[lot] * (wafer.run().key().positionInLot() - 2);
				squaredResiduals += (runLevels.get(wafer) - fitted) * (runLevels.get(wafer) - fitted);
			}
			lot++;
		}
		double runSd = Math.sqrt(squaredResiduals / (wafers.size() - 2 * lots.size()));

		// fast noise: readings around their cycle's shape, and their correlation from one sample to the next
		List<double[]> noiseSequences = new ArrayList<>();
		for (Wafer wafer : good) {
			int index = wafer.run().channels().indexOf(channel);
			double[] levels = cycleLevels.get(wafer);
			for (int cycle = 1; cycle <= cycles; cycle++) {
				if (Double.isNaN(levels[cycle])) {
					continue;
				}
				double[] residuals = new double[coreSize];
				for (int offset = coreFrom; offset <= coreTo; offset++) {
					float value = wafer.run().value(index, grid.slot(cycle, phase, offset));
					residuals[offset - coreFrom] = Float.isNaN(value) ? Double.NaN
							: value - profile[offset] - (levels[cycle] - coreLevel);
				}
				noiseSequences.add(residuals);
			}
		}
		// the typical offset's spread, so the few offsets where a step lands a sample early or late do not count
		double[] offsetSds = new double[coreSize];
		for (int k = 0; k < coreSize; k++) {
			int column = k;
			offsetSds[k] = trimmedSd(noiseSequences.stream().mapToDouble((residuals) -> residuals[column]).toArray());
		}
		double noiseSd = median(offsetSds) * Math.sqrt((double) coreSize / (coreSize - 1));
		double noiseRho = clamp(lag1(noiseSequences, 4 * noiseSd), 0, 0.99);

		// slow wander: cycle levels around run level and trend, less what averaged fast noise already explains
		List<double[]> wanderSequences = new ArrayList<>();
		for (Wafer wafer : good) {
			double[] levels = cycleLevels.get(wafer);
			double[] residuals = new double[cycles];
			Arrays.fill(residuals, Double.NaN);
			for (int cycle = 2; cycle < cycles; cycle++) {
				if (!Double.isNaN(levels[cycle])) {
					residuals[cycle] = levels[cycle] - runLevels.get(wafer) - cycleTrend[cycle];
				}
			}
			wanderSequences.add(residuals);
		}
		double cycleSd = trimmedSd(wanderSequences.stream().flatMapToDouble(Arrays::stream).toArray());
		double observedVariance = cycleSd * cycleSd;
		double wanderVariance = Math.max(0, observedVariance - noiseSd * noiseSd * meanVarianceFactor(coreSize, noiseRho));
		double observedPhi = lag1(wanderSequences, 4 * cycleSd);
		double wanderPhi = (wanderVariance > 0) ? clamp(observedPhi * observedVariance / wanderVariance, 0, 0.995) : 0;

		List<Double> trendList = new ArrayList<>(cycles);
		for (int cycle = 1; cycle <= cycles; cycle++) {
			trendList.add(cycleTrend[cycle]);
		}
		ChannelTemplate.PhaseTemplate template = new ChannelTemplate.PhaseTemplate(
				Arrays.stream(profile).boxed().toList(), trendList, sampleSd(lotLevels), runSd, mean(drifts),
				sampleSd(drifts), Math.sqrt(wanderVariance), noiseSd);

		// swings: runs of cycles far outside the typical spread, sized in band standard deviations
		List<SimulationTemplate.Swing> swings = new ArrayList<>();
		double threshold = Math.max(SWING_THRESHOLD * cycleSd, SWING_MIN_STEPS * resolution);
		double unit = bandSd(template);
		if (threshold > 0 && unit > 0) {
			for (double[] residuals : wanderSequences) {
				swings.addAll(swings(channel, residuals, threshold, unit));
			}
		}
		return new PhaseFit(template, noiseRho, wanderPhi, swings);
	}

	/** Runs of cycles beyond the threshold, joined across a single calmer cycle, each sized by its mean residual. */
	private static List<SimulationTemplate.Swing> swings(ChannelName channel, double[] residuals, double threshold,
			double unit) {
		List<SimulationTemplate.Swing> swings = new ArrayList<>();
		int first = -1;
		int last = -1;
		for (int cycle = 0; cycle <= residuals.length; cycle++) {
			boolean beyond = cycle < residuals.length && !Double.isNaN(residuals[cycle])
					&& Math.abs(residuals[cycle]) > threshold;
			if (beyond) {
				if (first < 0) {
					first = cycle;
				}
				last = cycle;
				continue;
			}
			if (first >= 0 && (cycle == residuals.length || cycle - last > 1)) {
				double sum = 0;
				int counted = 0;
				for (int k = first; k <= last; k++) {
					if (!Double.isNaN(residuals[k])) {
						sum += residuals[k];
						counted++;
					}
				}
				swings.add(new SimulationTemplate.Swing(channel, last - first + 1, sum / counted / unit));
				first = -1;
			}
		}
		return swings;
	}

	/**
	 * Root mean square of residuals centred on 0, after dropping the largest 2 % by size, scaled so a normal
	 * sample keeps its standard deviation. Unlike a median-based spread it stays right for readings that sit
	 * on a few levels, and unlike a plain root mean square a handful of dips cannot set it.
	 */
	private static double trimmedSd(double[] residuals) {
		double[] squares = Arrays.stream(residuals)
			.filter((value) -> !Double.isNaN(value))
			.map((value) -> value * value)
			.sorted()
			.toArray();
		if (squares.length == 0) {
			return 0;
		}
		boolean trim = squares.length >= 50;
		int kept = trim ? (int) Math.ceil(KEEP * squares.length) : squares.length;
		double sum = 0;
		for (int i = 0; i < kept; i++) {
			sum += squares[i];
		}
		return Math.sqrt(sum / kept) * (trim ? TRIM_CORRECTION : 1);
	}

	/** Lag-1 correlation within each sequence, residuals clipped at {@code clip}; NaN breaks a sequence. */
	private static double lag1(List<double[]> sequences, double clip) {
		double products = 0;
		double squares = 0;
		for (double[] sequence : sequences) {
			double previous = Double.NaN;
			for (double raw : sequence) {
				if (Double.isNaN(raw)) {
					previous = Double.NaN;
					continue;
				}
				double value = (clip > 0) ? clamp(raw, -clip, clip) : raw;
				if (!Double.isNaN(previous)) {
					products += previous * value;
					squares += previous * previous;
				}
				previous = value;
			}
		}
		return (squares > 0) ? products / squares : 0;
	}

	/**
	 * The per-cycle trend as measured, unsmoothed, so the first and last steady cycles keep their own level.
	 * Cycles without data take 0, and cycles 1 and 100, which are never scored, copy cycles 2 and 99.
	 */
	private static double[] withEdges(double[] trend) {
		int last = trend.length - 1;
		double[] filled = new double[trend.length];
		for (int i = 2; i < last; i++) {
			filled[i] = Double.isNaN(trend[i]) ? 0 : trend[i];
		}
		filled[1] = filled[2];
		filled[last] = filled[last - 1];
		return filled;
	}

	private static void fillFromNeighbours(double[] values) {
		int firstFinite = -1;
		for (int i = 0; i < values.length; i++) {
			if (!Double.isNaN(values[i])) {
				firstFinite = i;
				break;
			}
		}
		if (firstFinite < 0) {
			Arrays.fill(values, 0);
			return;
		}
		for (int i = 0; i < firstFinite; i++) {
			values[i] = values[firstFinite];
		}
		for (int i = firstFinite + 1; i < values.length; i++) {
			if (Double.isNaN(values[i])) {
				values[i] = values[i - 1];
			}
		}
	}

	private static double resolution(TreeSet<Float> distinct) {
		if (distinct == null || distinct.size() < 2) {
			return 0;
		}
		double smallest = Double.POSITIVE_INFINITY;
		Float previous = null;
		for (Float value : distinct) {
			if (previous != null) {
				smallest = Math.min(smallest, (double) value - previous);
			}
			previous = value;
		}
		return smallest;
	}

	private static double median(double[] values) {
		double[] sorted = values.clone();
		Arrays.sort(sorted);
		int middle = sorted.length / 2;
		return (sorted.length % 2 == 1) ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
	}

	private static double mean(double[] values) {
		return Arrays.stream(values).average().orElse(0);
	}

	private static double sampleSd(double[] values) {
		double mean = mean(values);
		double squares = Arrays.stream(values).map((value) -> (value - mean) * (value - mean)).sum();
		return (values.length > 1) ? Math.sqrt(squares / (values.length - 1)) : 0;
	}

	private static double clamp(double value, double low, double high) {
		return Math.max(low, Math.min(high, value));
	}

}
