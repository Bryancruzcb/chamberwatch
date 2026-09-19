package io.github.bryancruzcb.chamberwatch.depth;

import java.util.ArrayList;
import java.util.List;

/**
 * Ridge regression on standardized features, with an unpenalized intercept. The public lots give fewer wafers
 * than there are features, so it is solved in its dual form, over the {@code n x n} products of the training rows
 * instead of the {@code p x p} products of the features. The two forms give the same coefficients,
 * {@code (Z'Z + lambda I)^-1 Z'y = Z'(ZZ' + lambda I)^-1 y}, and the products do not depend on the penalty, so
 * {@link #fitEach} builds them once for every penalty it tries.
 */
final class Ridge {

	/** A feature whose spread over the training rows is at or below this is constant there and left out. */
	static final double CONSTANT = 1e-12;

	private Ridge() {
	}

	/**
	 * A fitted model.
	 *
	 * @param mean      each feature's mean over the training rows
	 * @param scale     each feature's standard deviation over them
	 * @param kept      the features that varied, in order
	 * @param intercept the training rows' mean target
	 * @param beta      one coefficient per kept feature, per standard deviation of that feature
	 */
	record Fit(double[] mean, double[] scale, int[] kept, double intercept, double[] beta) {

		double predict(double[] row) {
			double value = intercept;
			for (int k = 0; k < kept.length; k++) {
				int j = kept[k];
				value += beta[k] * (row[j] - mean[j]) / scale[j];
			}
			return value;
		}

	}

	static Fit fit(double[][] x, double[] y, double lambda) {
		return fitEach(x, y, new double[] { lambda }).get(0);
	}

	/** One fit per penalty, in the order given, all from the same standardization and products. */
	static List<Fit> fitEach(double[][] x, double[] y, double[] lambdas) {
		int n = x.length;
		if (n == 0 || n != y.length) {
			throw new IllegalArgumentException("ridge needs one target per row and at least one row");
		}
		int p = x[0].length;
		double[] mean = new double[p];
		double[] scale = new double[p];
		for (int j = 0; j < p; j++) {
			double sum = 0;
			for (double[] row : x) {
				sum += row[j];
			}
			mean[j] = sum / n;
			double squares = 0;
			for (double[] row : x) {
				squares += (row[j] - mean[j]) * (row[j] - mean[j]);
			}
			scale[j] = Math.sqrt(squares / n);
		}
		int[] kept = keptFeatures(scale);
		double[][] z = new double[n][kept.length];
		for (int i = 0; i < n; i++) {
			for (int k = 0; k < kept.length; k++) {
				int j = kept[k];
				z[i][k] = (x[i][j] - mean[j]) / scale[j];
			}
		}
		double intercept = 0;
		for (double target : y) {
			intercept += target;
		}
		intercept /= n;
		double[] centered = new double[n];
		for (int i = 0; i < n; i++) {
			centered[i] = y[i] - intercept;
		}
		double[][] gram = new double[n][n];
		for (int a = 0; a < n; a++) {
			for (int b = 0; b <= a; b++) {
				double product = 0;
				for (int k = 0; k < kept.length; k++) {
					product += z[a][k] * z[b][k];
				}
				gram[a][b] = product;
				gram[b][a] = product;
			}
		}
		List<Fit> fits = new ArrayList<>(lambdas.length);
		for (double lambda : lambdas) {
			if (!(lambda > 0)) {
				throw new IllegalArgumentException("a ridge penalty must be positive, not " + lambda);
			}
			double[] alpha = solvePositiveDefinite(gram, lambda, centered);
			double[] beta = new double[kept.length];
			for (int k = 0; k < kept.length; k++) {
				double sum = 0;
				for (int i = 0; i < n; i++) {
					sum += z[i][k] * alpha[i];
				}
				beta[k] = sum;
			}
			fits.add(new Fit(mean, scale, kept, intercept, beta));
		}
		return fits;
	}

	private static int[] keptFeatures(double[] scale) {
		int count = 0;
		for (double s : scale) {
			count += (s > CONSTANT) ? 1 : 0;
		}
		int[] kept = new int[count];
		int k = 0;
		for (int j = 0; j < scale.length; j++) {
			if (scale[j] > CONSTANT) {
				kept[k++] = j;
			}
		}
		return kept;
	}

	/** Solves {@code (gram + lambda I) x = b} by Cholesky; a positive penalty makes the matrix positive definite. */
	static double[] solvePositiveDefinite(double[][] gram, double lambda, double[] b) {
		int n = b.length;
		double[][] lower = new double[n][n];
		for (int i = 0; i < n; i++) {
			for (int j = 0; j <= i; j++) {
				double sum = gram[i][j] + ((i == j) ? lambda : 0);
				for (int k = 0; k < j; k++) {
					sum -= lower[i][k] * lower[j][k];
				}
				if (i == j) {
					if (!(sum > 0)) {
						throw new IllegalStateException("the ridge system is not positive definite");
					}
					lower[i][i] = Math.sqrt(sum);
				}
				else {
					lower[i][j] = sum / lower[j][j];
				}
			}
		}
		double[] forward = new double[n];
		for (int i = 0; i < n; i++) {
			double sum = b[i];
			for (int k = 0; k < i; k++) {
				sum -= lower[i][k] * forward[k];
			}
			forward[i] = sum / lower[i][i];
		}
		double[] solution = new double[n];
		for (int i = n - 1; i >= 0; i--) {
			double sum = forward[i];
			for (int k = i + 1; k < n; k++) {
				sum -= lower[k][i] * solution[k];
			}
			solution[i] = sum / lower[i][i];
		}
		return solution;
	}

}
