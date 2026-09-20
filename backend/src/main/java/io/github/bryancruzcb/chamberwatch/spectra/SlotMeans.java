package io.github.bryancruzcb.chamberwatch.spectra;

import java.util.ArrayList;
import java.util.List;

/**
 * Averages emission samples into the recipe's slots. The spectrometer runs at about 23 Hz and the telemetry at
 * 5 Hz, so several emission samples fall in one 0.2 s slot and their mean becomes the slot's value.
 *
 * <p>A sample joins the slot whose telemetry sample is nearest in time, and only when it is within
 * {@code toleranceS}; one that is farther belongs to no slot and is dropped, which is what happens before the etch,
 * after it, and in the stretches where the spectrometer skipped. Slots that no sample reached come out NaN, the
 * same value the grid uses for a slot the telemetry never filled.
 *
 * <p>Single use, like {@link io.github.bryancruzcb.chamberwatch.detect.BaselineFitter}: add every sample, then
 * finish once.
 */
public final class SlotMeans {

	private final int lines;

	private final SlotIndex index;

	private final double[] sums;

	private final int[] counts;

	private final int slotCount;

	private final int minimumSamples;

	private boolean finished;

	/**
	 * @param lines      how many values each sample carries, one per emission line
	 * @param slotTimes  the time the telemetry wrote for each slot, NaN in a slot it never filled
	 * @param toleranceS the farthest a sample may sit from a slot's time and still join it
	 * @param minimumSamples how many samples a slot needs before its mean is worth storing; a slot that got fewer
	 *                       comes out NaN, because one sample of a 23 Hz record is noise, not a 0.2 s average
	 */
	public SlotMeans(int lines, float[] slotTimes, double toleranceS, int minimumSamples) {
		if (lines < 1) {
			throw new IllegalArgumentException("a reduction needs at least one line");
		}
		if (minimumSamples < 1) {
			throw new IllegalArgumentException("a slot needs at least one sample, not " + minimumSamples);
		}
		this.minimumSamples = minimumSamples;
		this.lines = lines;
		this.index = new SlotIndex(slotTimes, toleranceS);
		this.slotCount = slotTimes.length;
		this.sums = new double[lines * slotCount];
		this.counts = new int[lines * slotCount];
	}

	/**
	 * Adds one sample of the spectrometer's, already on the run's clock.
	 *
	 * @param runTimeS the sample's time, in the same seconds as the slot times
	 * @param values   one value per line, in the order the lines were counted; a NaN value is dropped on its own
	 * @return true when the sample joined a slot
	 * @throws IllegalArgumentException when the sample does not carry one value per line
	 * @throws IllegalStateException    when the reduction has already finished
	 */
	public boolean add(double runTimeS, float[] values) {
		if (finished) {
			throw new IllegalStateException("this reduction has already finished");
		}
		if (values.length != lines) {
			throw new IllegalArgumentException(values.length + " values, not one per line");
		}
		int slot = index.slotOf(runTimeS);
		if (slot < 0) {
			return false;
		}
		for (int line = 0; line < lines; line++) {
			float value = values[line];
			if (!Float.isNaN(value)) {
				sums[line * slotCount + slot] += value;
				counts[line * slotCount + slot]++;
			}
		}
		return true;
	}

	/** The slot a time joins, or -1 when the nearest filled slot is farther away than the tolerance. */
	int slotOf(double runTimeS) {
		return index.slotOf(runTimeS);
	}

	/** How many samples joined each slot, for the line given, so a caller can judge the record's coverage. */
	public int[] samplesPerSlot(int line) {
		int[] perSlot = new int[slotCount];
		System.arraycopy(counts, line * slotCount, perSlot, 0, slotCount);
		return perSlot;
	}

	/** How many slots the telemetry filled, the most any reduction of this run could reach. */
	public int filledSlots() {
		return index.filledSlots();
	}

	/**
	 * The mean of each line in each slot, NaN in a slot no sample joined.
	 *
	 * @return one array per line, each one value per slot, in the order the lines were counted
	 * @throws IllegalStateException when called twice
	 */
	public List<float[]> finish() {
		if (finished) {
			throw new IllegalStateException("this reduction has already finished");
		}
		finished = true;
		List<float[]> means = new ArrayList<>(lines);
		for (int line = 0; line < lines; line++) {
			float[] bySlot = new float[slotCount];
			for (int slot = 0; slot < slotCount; slot++) {
				int count = counts[line * slotCount + slot];
				bySlot[slot] = (count < minimumSamples) ? Float.NaN : (float) (sums[line * slotCount + slot] / count);
			}
			means.add(bySlot);
		}
		return means;
	}

}
