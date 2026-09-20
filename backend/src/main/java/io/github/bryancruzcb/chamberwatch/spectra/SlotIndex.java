package io.github.bryancruzcb.chamberwatch.spectra;

import java.util.Arrays;

/**
 * The slots a run filled, in time order, so a time can be turned into the slot it belongs to. A time joins the
 * slot whose telemetry sample is nearest, and only when it is within the tolerance; anything farther belongs to no
 * slot, which is what happens before the etch, after it, and where the spectrometer skipped.
 */
final class SlotIndex {

	private final double[] times;

	private final int[] slots;

	private final double toleranceS;

	SlotIndex(float[] slotTimes, double toleranceS) {
		if (!(toleranceS > 0)) {
			throw new IllegalArgumentException("the tolerance must be positive, not " + toleranceS);
		}
		this.toleranceS = toleranceS;
		int filled = 0;
		for (float time : slotTimes) {
			if (!Float.isNaN(time)) {
				filled++;
			}
		}
		this.times = new double[filled];
		this.slots = new int[filled];
		int at = 0;
		for (int slot = 0; slot < slotTimes.length; slot++) {
			if (!Float.isNaN(slotTimes[slot])) {
				times[at] = slotTimes[slot];
				slots[at] = slot;
				at++;
			}
		}
		for (int i = 1; i < times.length; i++) {
			if (times[i] < times[i - 1]) {
				throw new IllegalArgumentException("the slot times are not in order at slot " + slots[i]);
			}
		}
	}

	/** The slot a time joins, or -1 when the nearest filled slot is farther away than the tolerance. */
	int slotOf(double timeS) {
		if (times.length == 0 || Double.isNaN(timeS)) {
			return -1;
		}
		int at = Arrays.binarySearch(times, timeS);
		if (at >= 0) {
			return slots[at];
		}
		int after = -at - 1;
		int nearest = -1;
		double best = Double.POSITIVE_INFINITY;
		for (int candidate = after - 1; candidate <= after; candidate++) {
			if (candidate < 0 || candidate >= times.length) {
				continue;
			}
			double distance = Math.abs(times[candidate] - timeS);
			if (distance < best) {
				best = distance;
				nearest = slots[candidate];
			}
		}
		return (best <= toleranceS) ? nearest : -1;
	}

	int filledSlots() {
		return times.length;
	}

}
