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
		for (Point point : points) {
			sxx += (point.position() - positionMean) * (point.position() - positionMean);
			sxy += (point.position() - positionMean) * (point.value() - valueMean);
		}
		if (sxx == 0) {
			throw new IllegalArgumentException("a lot fit needs points at more than one position");
		}
		double slope = sxy / sxx;
		double intercept = valueMean - slope * positionMean;
		double tStat = Double.NaN;
		if (n >= 3) {
			double squaredErrors = 0;
			for (Point point : points) {
				double residual = point.value() - intercept - slope * point.position();
				squaredErrors += residual * residual;
			}
			double standardError = Math.sqrt(squaredErrors / (n - 2) / sxx);
			if (standardError > 0) {
				tStat = slope / standardError;
			}
			else {
				tStat = (slope == 0) ? 0 : Math.copySign(Double.POSITIVE_INFINITY, slope);
			}
		}
		int asOf = points.stream().mapToInt(Point::position).max().orElseThrow();
		return new LotFit(asOf, n, slope, intercept, tStat);
	}

	public double valueAt(double position) {
		return intercept + slope * position;
	}

}
