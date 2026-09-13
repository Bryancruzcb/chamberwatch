package io.github.bryancruzcb.chamberwatch.detect;

import java.util.List;

/**
 * Least squares of one run summary against position in lot, over the wafers up to {@code asOfPosition}.
 *
 * @param runs  points in the fit
 * @param tStat the slope over its standard error; NaN with fewer than 3 points, infinite for an exact line
 */
public record LotFit(int asOfPosition, int runs, double slope, double intercept, double tStat) {

	/** One wafer's value at its position in the lot. */
	public record Point(int position, double value) {
	}

	/** @throws IllegalArgumentException with fewer than 2 points or with every point at one position */
	public static LotFit of(List<Point> points) {
		int n = points.size();
		if (n < 2) {
			throw new IllegalArgumentException("a lot fit needs at least 2 points");
		}
		double positionMean = points.stream().mapToDouble(Point::position).average().orElseThrow();
		double valueMean = points.stream().mapToDouble(Point::value).average().orElseThrow();
		double sxx = 0;
		double sxy = 0;
		double syy = 0;
		for (Point point : points) {
			sxx += (point.position() - positionMean) * (point.position() - positionMean);
			sxy += (point.position() - positionMean) * (point.value() - valueMean);
			syy += (point.value() - valueMean) * (point.value() - valueMean);
		}
		int asOf = points.stream().mapToInt(Point::position).max().orElseThrow();
		return fromSums(asOf, n, positionMean, valueMean, sxx, sxy, syy);
	}

	/**
	 * The fit from the sums a regression aggregate keeps, the ones PostgreSQL's {@code regr_count},
	 * {@code regr_avgx}, {@code regr_avgy}, {@code regr_sxx}, {@code regr_sxy} and {@code regr_syy} return, so a
	 * fit computed in SQL is judged exactly like one computed from points.
	 *
	 * @throws IllegalArgumentException with fewer than 2 points or with every point at one position
	 */
	public static LotFit fromSums(int asOfPosition, long n, double positionMean, double valueMean, double sxx,
			double sxy, double syy) {
		if (n < 2) {
			throw new IllegalArgumentException("a lot fit needs at least 2 points");
		}
		if (!(sxx > 0)) {
			throw new IllegalArgumentException("a lot fit needs points at more than one position");
		}
		double slope = sxy / sxx;
		double intercept = valueMean - slope * positionMean;
		double tStat = Double.NaN;
		if (n >= 3) {
			// rounding can leave the squared residuals of an exact line a hair below zero
			double squaredErrors = Math.max(0, syy - slope * sxy);
			double standardError = Math.sqrt(squaredErrors / (n - 2) / sxx);
			if (standardError > 0) {
				tStat = slope / standardError;
			}
			else {
				tStat = (slope == 0) ? 0 : Math.copySign(Double.POSITIVE_INFINITY, slope);
			}
		}
		return new LotFit(asOfPosition, (int) n, slope, intercept, tStat);
	}

	public double valueAt(double position) {
		return intercept + slope * position;
	}

}
