package io.github.bryancruzcb.chamberwatch.depth;

import java.util.List;
import java.util.SplittableRandom;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;
import static org.assertj.core.api.Assertions.within;

class RidgeTest {

	@Test
	void theDualFormGivesThePrimalCoefficientsWithFewerRowsThanFeaturesAndWithMore() {
		for (int[] shape : new int[][] { { 8, 20 }, { 40, 5 } }) {
			double[][] x = randomRows(shape[0], shape[1], 11);
			double[] y = randomTargets(x, 12);

			Ridge.Fit dual = Ridge.fit(x, y, 2.5);

			double[] primal = primalBeta(x, y, 2.5);
			for (int k = 0; k < primal.length; k++) {
				assertThat(dual.beta()[k]).as("coefficient %d of %s", k, shape).isCloseTo(primal[k], within(1e-9));
			}
		}
	}

	@Test
	void aTinyPenaltyFitsAnExactLinearTargetAndAHugeOnePredictsTheMean() {
		double[][] x = randomRows(30, 3, 21);
		double[] y = new double[30];
		for (int i = 0; i < 30; i++) {
			y[i] = 40 + 1.5 * x[i][0] - 0.5 * x[i][1];
		}

		Ridge.Fit tiny = Ridge.fit(x, y, 1e-9);
		Ridge.Fit huge = Ridge.fit(x, y, 1e12);

		double mean = 0;
		for (double target : y) {
			mean += target / 30;
		}
		for (int i = 0; i < 30; i++) {
			assertThat(tiny.predict(x[i])).isCloseTo(y[i], within(1e-6));
			assertThat(huge.predict(x[i])).isCloseTo(mean, within(1e-6));
		}
	}

	@Test
	void aFeatureConstantInTheTrainingRowsIsLeftOutAndCannotMoveAPrediction() {
		double[][] x = randomRows(20, 4, 31);
		for (double[] row : x) {
			row[2] = 7.0;
		}
		double[] y = randomTargets(x, 32);

		Ridge.Fit fit = Ridge.fit(x, y, 1.0);

		assertThat(fit.kept()).containsExactly(0, 1, 3);
		double[] changed = x[0].clone();
		changed[2] = 1_000.0;
		assertThat(fit.predict(changed)).isEqualTo(fit.predict(x[0]));
	}

	@Test
	void fittingEveryPenaltyAtOnceMatchesFittingEachAlone() {
		double[][] x = randomRows(12, 30, 41);
		double[] y = randomTargets(x, 42);
		double[] lambdas = { 0.01, 1, 100 };

		List<Ridge.Fit> together = Ridge.fitEach(x, y, lambdas);

		for (int l = 0; l < lambdas.length; l++) {
			assertThat(together.get(l).beta()).containsExactly(Ridge.fit(x, y, lambdas[l]).beta());
		}
	}

	@Test
	void aPenaltyMustBePositive() {
		double[][] x = randomRows(5, 2, 51);

		assertThatIllegalArgumentException().isThrownBy(() -> Ridge.fit(x, randomTargets(x, 52), 0));
	}

	/** The primal solution {@code (Z'Z + lambda I)^-1 Z'(y - mean)} on standardized columns, for comparison. */
	private static double[] primalBeta(double[][] x, double[] y, double lambda) {
		int n = x.length;
		int p = x[0].length;
		double[][] z = new double[n][p];
		for (int j = 0; j < p; j++) {
			double mean = 0;
			for (double[] row : x) {
				mean += row[j] / n;
			}
			double squares = 0;
			for (double[] row : x) {
				squares += (row[j] - mean) * (row[j] - mean);
			}
			double scale = Math.sqrt(squares / n);
			for (int i = 0; i < n; i++) {
				z[i][j] = (x[i][j] - mean) / scale;
			}
		}
		double yMean = 0;
		for (double target : y) {
			yMean += target / n;
		}
		double[][] gram = new double[p][p];
		double[] right = new double[p];
		for (int a = 0; a < p; a++) {
			for (int b = 0; b < p; b++) {
				for (int i = 0; i < n; i++) {
					gram[a][b] += z[i][a] * z[i][b];
				}
			}
			for (int i = 0; i < n; i++) {
				right[a] += z[i][a] * (y[i] - yMean);
			}
		}
		return Ridge.solvePositiveDefinite(gram, lambda, right);
	}

	private static double[][] randomRows(int n, int p, long seed) {
		SplittableRandom random = new SplittableRandom(seed);
		double[][] x = new double[n][p];
		for (double[] row : x) {
			for (int j = 0; j < p; j++) {
				row[j] = random.nextDouble(-2, 2) * (j + 1);
			}
		}
		return x;
	}

	private static double[] randomTargets(double[][] x, long seed) {
		SplittableRandom random = new SplittableRandom(seed);
		double[] y = new double[x.length];
		for (int i = 0; i < x.length; i++) {
			y[i] = 40 + x[i][0] - 0.3 * x[i][x[i].length - 1] + random.nextGaussian(0, 0.1);
		}
		return y;
	}

}
