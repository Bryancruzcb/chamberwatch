package io.github.bryancruzcb.chamberwatch.sim;

import java.util.Optional;

/** Which run to simulate: a wafer position in a lot, and the fault to inject, if any. */
public record RunSpec(int lotNo, int position, Optional<FaultPlan> fault) {

	public RunSpec {
		if (lotNo < 1 || position < 1 || position > 99) {
			throw new IllegalArgumentException("invalid simulated lot " + lotNo + " wafer " + position);
		}
	}

	public static RunSpec clean(int lotNo, int position) {
		return new RunSpec(lotNo, position, Optional.empty());
	}

	public static RunSpec faulted(int lotNo, int position, FaultPlan fault) {
		return new RunSpec(lotNo, position, Optional.of(fault));
	}

}
