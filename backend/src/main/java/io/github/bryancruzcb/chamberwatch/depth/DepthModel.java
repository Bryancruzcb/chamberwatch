package io.github.bryancruzcb.chamberwatch.depth;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalDouble;
import java.util.SortedMap;
import java.util.SortedSet;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.function.Predicate;
import java.util.stream.IntStream;

/**
 * Predicts each wafer's mean etch depth from its telemetry, a virtual metrology model, and scores it honestly: every
 * lot is predicted by a model fitted on the other lots only, and the model's penalty is chosen by leave-one-lot-out
 * inside those other lots, so no lot ever takes part in its own prediction. Two baselines are scored the same
 * way: a straight line in position in the lot, and the mean of the lot's own first wafers.
 *
 * <p>A calculation over the data it is given: the same data give the same report.
 */
public final class DepthModel {

	/** Penalties tried: 13 steps of a factor of about 3.16, from 0.001 to 1000. */
	public static final List<Double> LAMBDAS = IntStream.rangeClosed(0, 12)
		.mapToObj((i) -> Math.pow(10, -3 + i * 0.5))
		.toList();

	/** Wafers 1 to this of each lot are the first wafers, as in the baseline. */
	public static final int FIRST_WAFERS = 3;

	/** Lots with a measured wafer the model needs: one held out, and two to choose its penalty by holding each out. */
	public static final int MINIMUM_LOTS = 3;

	/** Coefficients reported. */
	static final int STRONGEST = 10;

	private DepthModel() {
	}

	/**
	 * @return the report, or empty when fewer than three lots have a measured wafer, too few to choose a penalty
	 *         without the held-out lot
	 */
	public static Optional<DepthReport> evaluate(DepthData data, List<Double> lambdas) {
		List<DepthSample> samples = data.samples();
		List<DepthSample> measured = samples.stream().filter(DepthSample::measured).toList();
		SortedSet<Integer> measuredLots = lots(measured);
		if (measuredLots.size() < MINIMUM_LOTS) {
			return Optional.empty();
		}
		double[] penalties = lambdas.stream().mapToDouble(Double::doubleValue).toArray();

		SortedMap<Integer, Double> firstWafers = firstWaferMeans(measured);
		List<Prediction> telemetry = new ArrayList<>();
		List<Prediction> position = new ArrayList<>();
		for (int lot : lots(samples)) {
			List<DepthSample> train = measured.stream().filter((s) -> s.lotNo() != lot).toList();
			List<DepthSample> held = samples.stream().filter((s) -> s.lotNo() == lot).toList();
			double lambda = chooseLambda(train, penalties);
			Ridge.Fit fit = Ridge.fit(features(train), depths(train), lambda);
			Line line = Line.fit(train);
			for (DepthSample sample : held) {
				telemetry.add(new Prediction(sample, fit.predict(sample.features()), lambda));
				position.add(new Prediction(sample, line.at(sample.position()), Double.NaN));
			}
		}

		Predicate<DepthSample> late = (s) -> s.position() > FIRST_WAFERS && firstWafers.containsKey(s.lotNo());
		List<DepthReport.MethodErrors> methods = List.of(
				new DepthReport.MethodErrors(DepthReport.Method.TELEMETRY, Optional.of(errors(telemetry, (s) -> true)),
						errors(telemetry, late)),
				new DepthReport.MethodErrors(DepthReport.Method.POSITION, Optional.of(errors(position, (s) -> true)),
						errors(position, late)),
				new DepthReport.MethodErrors(DepthReport.Method.FIRST_WAFERS, Optional.empty(), errors(measured.stream()
					.filter(late)
					.map((s) -> new Prediction(s, firstWafers.get(s.lotNo()), Double.NaN))
					.toList(), (s) -> true)));

		double wholeLambda = chooseLambda(measured, penalties);
		Ridge.Fit whole = Ridge.fit(features(measured), depths(measured), wholeLambda);
		return Optional.of(new DepthReport(measured.size(), measuredLots.size(), data.featureNames().size(), methods,
				strongest(whole, data.featureNames()), wholeLambda, reported(telemetry), byPosition(telemetry)));
	}

	/**
	 * The penalty with the smallest squared error when each lot among these samples is predicted from the others.
	 * The first of equal ones wins, which is the smallest.
	 */
	static double chooseLambda(List<DepthSample> samples, double[] lambdas) {
		double[] squared = new double[lambdas.length];
		for (int lot : lots(samples)) {
			List<DepthSample> train = samples.stream().filter((s) -> s.lotNo() != lot).toList();
			List<DepthSample> held = samples.stream().filter((s) -> s.lotNo() == lot).toList();
			List<Ridge.Fit> fits = Ridge.fitEach(features(train), depths(train), lambdas);
			for (int l = 0; l < lambdas.length; l++) {
				for (DepthSample sample : held) {
					double error = fits.get(l).predict(sample.features()) - sample.depth();
					squared[l] += error * error;
				}
			}
		}
		int best = 0;
		for (int l = 1; l < lambdas.length; l++) {
			if (squared[l] < squared[best]) {
				best = l;
			}
		}
		return lambdas[best];
	}

	/** A prediction of one wafer, with the penalty behind it or NaN for a baseline. */
	private record Prediction(DepthSample sample, double predictedUm, double lambda) {

		double error() {
			return predictedUm - sample.depth();
		}

	}

	/** Depth as a straight line in position, fitted by least squares; flat when the positions do not vary. */
	private record Line(double intercept, double slope) {

		static Line fit(List<DepthSample> samples) {
			double meanPosition = samples.stream().mapToDouble(DepthSample::position).average().orElseThrow();
			double meanDepth = samples.stream().mapToDouble(DepthSample::depth).average().orElseThrow();
			double sxy = 0;
			double sxx = 0;
			for (DepthSample sample : samples) {
				sxy += (sample.position() - meanPosition) * (sample.depth() - meanDepth);
				sxx += (sample.position() - meanPosition) * (sample.position() - meanPosition);
			}
			double slope = (sxx > 0) ? sxy / sxx : 0;
			return new Line(meanDepth - slope * meanPosition, slope);
		}

		double at(int position) {
			return intercept + slope * position;
		}

	}

	private static SortedSet<Integer> lots(List<DepthSample> samples) {
		SortedSet<Integer> lots = new TreeSet<>();
		samples.forEach((sample) -> lots.add(sample.lotNo()));
		return lots;
	}

	private static double[][] features(List<DepthSample> samples) {
		return samples.stream().map(DepthSample::features).toArray(double[][]::new);
	}

	private static double[] depths(List<DepthSample> samples) {
		return samples.stream().mapToDouble(DepthSample::depth).toArray();
	}

	/** Each lot's mean measured depth over its first wafers, for lots where one of them was measured. */
	private static SortedMap<Integer, Double> firstWaferMeans(List<DepthSample> measured) {
		SortedMap<Integer, List<Double>> depths = new TreeMap<>();
		for (DepthSample sample : measured) {
			if (sample.position() <= FIRST_WAFERS) {
				depths.computeIfAbsent(sample.lotNo(), (lot) -> new ArrayList<>()).add(sample.depth());
			}
		}
		SortedMap<Integer, Double> means = new TreeMap<>();
		depths.forEach((lot, values) -> means.put(lot, values.stream().mapToDouble(Double::doubleValue).average().orElseThrow()));
		return means;
	}

	/** Errors over the measured wafers among the predictions that pass the filter. */
	private static DepthReport.Errors errors(List<Prediction> predictions, Predicate<DepthSample> which) {
		double squared = 0;
		double absolute = 0;
		int count = 0;
		for (Prediction prediction : predictions) {
			if (prediction.sample().measured() && which.test(prediction.sample())) {
				squared += prediction.error() * prediction.error();
				absolute += Math.abs(prediction.error());
				count++;
			}
		}
		return new DepthReport.Errors(count, (count == 0) ? Double.NaN : Math.sqrt(squared / count),
				(count == 0) ? Double.NaN : absolute / count);
	}

	private static List<DepthReport.Coefficient> strongest(Ridge.Fit fit, List<String> names) {
		List<DepthReport.Coefficient> coefficients = new ArrayList<>();
		for (int k = 0; k < fit.kept().length; k++) {
			coefficients.add(new DepthReport.Coefficient(names.get(fit.kept()[k]), fit.beta()[k]));
		}
		return coefficients.stream()
			.sorted(Comparator.comparingDouble((DepthReport.Coefficient c) -> -Math.abs(c.perSdUm())))
			.limit(STRONGEST)
			.toList();
	}

	private static List<DepthReport.Prediction> reported(List<Prediction> telemetry) {
		Map<Integer, OptionalDouble> lotRmse = new TreeMap<>();
		for (int lot : lots(telemetry.stream().map(Prediction::sample).toList())) {
			DepthReport.Errors errors = errors(telemetry, (s) -> s.lotNo() == lot);
			lotRmse.put(lot, (errors.wafers() == 0) ? OptionalDouble.empty() : OptionalDouble.of(errors.rmseUm()));
		}
		return telemetry.stream()
			.sorted(Comparator.comparingInt((Prediction p) -> p.sample().lotNo()).thenComparingInt((p) -> p.sample().position()))
			.map((p) -> new DepthReport.Prediction(p.sample().runId(), p.sample().lotNo(), p.sample().position(),
					p.predictedUm(), p.sample().measuredUm(), p.lambda(), lotRmse.get(p.sample().lotNo())))
			.toList();
	}

	private static List<DepthReport.PositionDepth> byPosition(List<Prediction> telemetry) {
		SortedMap<Integer, List<Prediction>> measured = new TreeMap<>();
		for (Prediction prediction : telemetry) {
			if (prediction.sample().measured()) {
				measured.computeIfAbsent(prediction.sample().position(), (position) -> new ArrayList<>()).add(prediction);
			}
		}
		List<DepthReport.PositionDepth> positions = new ArrayList<>();
		measured.forEach((position, predictions) -> positions.add(new DepthReport.PositionDepth(position,
				predictions.size(), predictions.stream().mapToDouble((p) -> p.sample().depth()).average().orElseThrow(),
				predictions.stream().mapToDouble(Prediction::predictedUm).average().orElseThrow())));
		return positions;
	}

}
