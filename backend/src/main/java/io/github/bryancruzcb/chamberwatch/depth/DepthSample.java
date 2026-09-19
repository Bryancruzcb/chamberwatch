package io.github.bryancruzcb.chamberwatch.depth;

import java.util.OptionalDouble;

/**
 * One wafer as the depth model sees it: which lot and position it has, what its telemetry summarized to, and what
 * was measured on it.
 *
 * @param features   one value per feature of the data set, in the data set's order
 * @param measuredUm the mean etch depth over the wafer's measured sites, empty when it was not measured
 */
public record DepthSample(int runId, int lotNo, int position, double[] features, OptionalDouble measuredUm) {

	public DepthSample {
		features = features.clone();
	}

	@Override
	public double[] features() {
		return features.clone();
	}

	boolean measured() {
		return measuredUm.isPresent();
	}

	double depth() {
		return measuredUm.orElseThrow();
	}

}
