package io.github.bryancruzcb.chamberwatch.spectra;

import java.util.Optional;

/**
 * Where the plasma burned in a wafer's emission record: the first and last sample of the etch, found in the
 * spectra alone. The fluorine line steps by about 190 times between a dark chamber and an SF6 phase, so the edge
 * is unmistakable, and a crossing counts only when it holds, which is what keeps the recipe's brief low-power
 * strike from passing for the etch.
 *
 * @param first the first sample of the etch
 * @param last  the last sample of the etch, inclusive
 * @param dark  the line's mean reading before the plasma, the baseline the reduction subtracts
 */
public record PlasmaWindow(int first, int last, double dark) {

	/** The share of the step above the dark level that counts as the plasma being on. */
	private static final double THRESHOLD = 0.30;

	/** How long a crossing must hold to count as the etch and not a strike. */
	private static final double HOLD_S = 1.0;

	/** The half-width of the smoothing that steadies the edge, in samples. */
	private static final int SMOOTH = 3;

	/**
	 * Finds the etch in one line's readings.
	 *
	 * @param line  the plasma line's value per sample, in the file's own units
	 * @param times the sample times, ascending, in seconds
	 * @return empty when the record never crosses the threshold for long enough, which is a wafer whose spectra
	 *         cannot be placed and must be left alone
	 */
	public static Optional<PlasmaWindow> find(float[] line, double[] times) {
		if (line.length != times.length) {
			throw new IllegalArgumentException("one time per sample is needed, not " + times.length + " for "
					+ line.length + " samples");
		}
		if (line.length < 2 * SMOOTH + 2) {
			return Optional.empty();
		}
		double[] smoothed = smooth(line);
		double[] sorted = smoothed.clone();
		java.util.Arrays.sort(sorted);
		double off = sorted[(int) (0.03 * (sorted.length - 1))];
		double on = sorted[(int) (0.90 * (sorted.length - 1))];
		if (!(on > off)) {
			return Optional.empty();
		}
		double threshold = off + THRESHOLD * (on - off);
		int first = -1;
		int last = -1;
		int at = 0;
		while (at < smoothed.length) {
			if (smoothed[at] < threshold) {
				at++;
				continue;
			}
			int end = at;
			while (end + 1 < smoothed.length && smoothed[end + 1] >= threshold) {
				end++;
			}
			if (times[end] - times[at] >= HOLD_S) {
				if (first < 0) {
					first = at;
				}
				last = end;
			}
			at = end + 1;
		}
		if (first < 0) {
			return Optional.empty();
		}
		return Optional.of(new PlasmaWindow(first, last, mean(line, 0, first)));
	}

	/** The line's mean over the samples before the plasma, or NaN when the record starts inside the etch. */
	private static double mean(float[] line, int from, int to) {
		if (to <= from) {
			return Double.NaN;
		}
		double sum = 0;
		for (int at = from; at < to; at++) {
			sum += line[at];
		}
		return sum / (to - from);
	}

	private static double[] smooth(float[] line) {
		double[] smoothed = new double[line.length];
		for (int at = 0; at < line.length; at++) {
			int from = Math.max(0, at - SMOOTH);
			int to = Math.min(line.length, at + SMOOTH + 1);
			double sum = 0;
			for (int near = from; near < to; near++) {
				sum += line[near];
			}
			smoothed[at] = sum / (to - from);
		}
		return smoothed;
	}

	public int samples() {
		return last - first + 1;
	}

}
