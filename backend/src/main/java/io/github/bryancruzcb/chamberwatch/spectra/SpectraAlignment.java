package io.github.bryancruzcb.chamberwatch.spectra;

import java.util.Optional;

import io.github.bryancruzcb.chamberwatch.recipe.Phase;
import io.github.bryancruzcb.chamberwatch.recipe.RecipeGrid;

/**
 * Puts a wafer's emission record on its run's clock.
 *
 * <p>The spectrometer stamps its samples in wall-clock seconds and the telemetry counts from its own first
 * sample, so the two records have to be lined up by something both of them saw: the plasma. The onset in the
 * spectra against the etch's start in the telemetry gives an offset within about a second, and the recipe itself
 * settles the rest. The etchant line rises in the SF6 phase and the passivation line rises in the C4F8 phase, so
 * the offset that makes those two agree with the grid's phases is the right one, and a wrong offset shows up at
 * once: one slot out already halves the contrast and half a cycle out inverts it.
 *
 * <p>A calculation: the same record and the same grid give the same offset.
 */
public final class SpectraAlignment {

	/** How far either side of the coarse guess the scan looks. The cycle repeats every 6 s, so this cannot grow. */
	static final double SEARCH_S = 2.5;

	static final double COARSE_STEP_S = 0.01;

	static final double FINE_STEP_S = 0.002;

	/** Half a slot: a sample joins the slot whose time is nearest within this. */
	public static final double TOLERANCE_S = 0.1;

	/**
	 * How far the phases must separate before an alignment is believed. The public wafers reach 4.2 at the best
	 * offset and 3.3 with a deliberately crude one, while half a cycle out reads below zero.
	 */
	public static final double MINIMUM_CONTRAST = 3.5;

	/**
	 * @param seconds  what to add to a sample's time since the record started to put it on the run's clock
	 * @param contrast how far the two lines separate between the phases, in standard deviations
	 */
	public record Offset(double seconds, double contrast) {
	}

	private SpectraAlignment() {
	}

	/**
	 * @param sinceStart  each sample's time since the emission record's first sample, ascending
	 * @param etchant     the fluorine line's value per sample
	 * @param passivation the carbon line's value per sample
	 * @param window      where the plasma burned in the emission record
	 * @param slotTimes   the time the telemetry wrote for each slot, NaN in a slot it never filled
	 * @param guessS      the offset the plasma's two edges suggest
	 * @return the best offset, or empty when the record has no plasma samples to score
	 */
	public static Optional<Offset> align(double[] sinceStart, float[] etchant, float[] passivation,
			PlasmaWindow window, float[] slotTimes, RecipeGrid grid, double guessS) {
		if (window.samples() < 2) {
			return Optional.empty();
		}
		double[] etchantZ = standardize(etchant, window);
		double[] passivationZ = standardize(passivation, window);
		if (etchantZ == null || passivationZ == null) {
			return Optional.empty();
		}
		SlotIndex index = new SlotIndex(slotTimes, TOLERANCE_S);
		Phase[] phases = phases(grid, slotTimes.length);
		Offset coarse = scan(sinceStart, etchantZ, passivationZ, window, index, phases, guessS, SEARCH_S,
				COARSE_STEP_S);
		return Optional.of(scan(sinceStart, etchantZ, passivationZ, window, index, phases, coarse.seconds(),
				COARSE_STEP_S, FINE_STEP_S));
	}

	private static Offset scan(double[] sinceStart, double[] etchantZ, double[] passivationZ, PlasmaWindow window,
			SlotIndex index, Phase[] phases, double centreS, double halfWidthS, double stepS) {
		Offset best = new Offset(centreS, Double.NEGATIVE_INFINITY);
		int steps = (int) Math.round(halfWidthS / stepS);
		for (int step = -steps; step <= steps; step++) {
			double offset = centreS + step * stepS;
			double contrast = contrast(sinceStart, etchantZ, passivationZ, window, index, phases, offset);
			if (contrast > best.contrast()) {
				best = new Offset(offset, contrast);
			}
		}
		return best;
	}

	/**
	 * How far the two lines separate between the phases at one offset: the etchant above the passivation in the SF6
	 * slots, minus the same difference in the C4F8 slots, both in standard deviations of the plasma window.
	 */
	private static double contrast(double[] sinceStart, double[] etchantZ, double[] passivationZ, PlasmaWindow window,
			SlotIndex index, Phase[] phases, double offsetS) {
		double sf6 = 0;
		double c4f8 = 0;
		int sf6Samples = 0;
		int c4f8Samples = 0;
		for (int sample = window.first(); sample <= window.last(); sample++) {
			int slot = index.slotOf(sinceStart[sample] + offsetS);
			if (slot < 0) {
				continue;
			}
			double difference = etchantZ[sample] - passivationZ[sample];
			if (phases[slot] == Phase.SF6) {
				sf6 += difference;
				sf6Samples++;
			}
			else {
				c4f8 += difference;
				c4f8Samples++;
			}
		}
		if (sf6Samples == 0 || c4f8Samples == 0) {
			return Double.NEGATIVE_INFINITY;
		}
		return sf6 / sf6Samples - c4f8 / c4f8Samples;
	}

	/** The line's readings over the plasma window, as standard deviations from their mean, or null when flat. */
	private static double[] standardize(float[] line, PlasmaWindow window) {
		double sum = 0;
		for (int sample = window.first(); sample <= window.last(); sample++) {
			sum += line[sample];
		}
		double mean = sum / window.samples();
		double squares = 0;
		for (int sample = window.first(); sample <= window.last(); sample++) {
			squares += (line[sample] - mean) * (line[sample] - mean);
		}
		double sd = Math.sqrt(squares / window.samples());
		if (!(sd > 0)) {
			return null;
		}
		double[] z = new double[line.length];
		for (int sample = 0; sample < line.length; sample++) {
			z[sample] = (line[sample] - mean) / sd;
		}
		return z;
	}

	private static Phase[] phases(RecipeGrid grid, int slots) {
		Phase[] phases = new Phase[slots];
		for (int slot = 0; slot < slots; slot++) {
			phases[slot] = grid.position(slot).phase();
		}
		return phases;
	}

}
