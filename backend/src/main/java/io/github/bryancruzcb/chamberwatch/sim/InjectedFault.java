package io.github.bryancruzcb.chamberwatch.sim;

import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;

/**
 * A fault as it went into one run, in the run's own time: seconds after its first sample.
 *
 * @param endS when the fault stopped changing readings; the etch end for one that lasted
 */
public record InjectedFault(FaultPlan plan, double startS, double endS) {

	public FaultKind kind() {
		return plan.kind();
	}

	public ChannelName channel() {
		return plan.channel();
	}

}
