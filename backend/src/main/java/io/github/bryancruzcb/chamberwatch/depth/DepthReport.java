package io.github.bryancruzcb.chamberwatch.depth;

import java.util.List;
import java.util.Optional;
import java.util.OptionalDouble;

/**
 * How well the wafers' telemetry predicts their measured depth when each lot is predicted by a model that never
 * saw it, next to two baselines, and every wafer's prediction.
 *
 * @param wafers      measured wafers the errors count
 * @param lots        lots among them
 * @param features    features per wafer
 * @param methods     the model and the two baselines, in that order
 * @param strongest   the largest coefficients of the model fitted on every lot, largest first
 * @param lambda      the penalty that fit chose, by leave-one-lot-out over every lot
 * @param predictions every wafer, measured or not, predicted by the model fitted without its lot
 * @param byPosition  measured and predicted depth averaged over the measured wafers at each position in the lot
 */
public record DepthReport(int wafers, int lots, int features, List<MethodErrors> methods, List<Coefficient> strongest,
		double lambda, List<Prediction> predictions, List<PositionDepth> byPosition) {

	public DepthReport {
		methods = List.copyOf(methods);
		strongest = List.copyOf(strongest);
		predictions = List.copyOf(predictions);
		byPosition = List.copyOf(byPosition);
	}

	public enum Method {

		/** Ridge regression on the phase means and spreads of every channel, fitted without the wafer's lot. */
		TELEMETRY,

		/** A straight line in position in the lot, fitted without the wafer's lot. */
		POSITION,

		/** The mean measured depth of the wafer's own lot's first wafers, for the wafers after them. */
		FIRST_WAFERS

	}

	/** Root mean square and mean absolute error over some wafers, in micrometres. */
	public record Errors(int wafers, double rmseUm, double maeUm) {
	}

	/**
	 * @param all  over every measured wafer; empty for the first-wafers baseline, which needs the first wafers' own
	 *             depth
	 * @param late over the measured wafers after the first ones, in lots where a first wafer was measured, the set
	 *             every method can be scored on
	 */
	public record MethodErrors(Method method, Optional<Errors> all, Errors late) {
	}

	/** @param perSdUm micrometres of depth per standard deviation of the feature, with its sign */
	public record Coefficient(String feature, double perSdUm) {
	}

	/**
	 * @param lambda    the penalty the model for this wafer's lot chose, without that lot
	 * @param lotRmseUm the model's error over the measured wafers of this wafer's lot, empty when none was measured
	 */
	public record Prediction(int runId, int lotNo, int position, double predictedUm, OptionalDouble measuredUm,
			double lambda, OptionalDouble lotRmseUm) {
	}

	public record PositionDepth(int position, int wafers, double meanMeasuredUm, double meanPredictedUm) {
	}

}
