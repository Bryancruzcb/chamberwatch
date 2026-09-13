package io.github.bryancruzcb.chamberwatch.detect;

/**
 * How one summary statistic spreads across good runs.
 *
 * @param mean the statistic's mean over good runs
 * @param sd   its standard deviation, already floored when fitting, so always positive
 */
public record SummaryBand(double mean, double sd) {

	public SummaryBand {
		if (!Double.isFinite(mean) || !Double.isFinite(sd) || !(sd > 0)) {
			throw new IllegalArgumentException("invalid summary band " + mean + " +/- " + sd);
		}
	}

	/** The one z-score formula for summaries. */
	public double z(double value) {
		return (value - mean) / sd;
	}

	public double low(double k) {
		return mean - k * sd;
	}

	public double high(double k) {
		return mean + k * sd;
	}

}
