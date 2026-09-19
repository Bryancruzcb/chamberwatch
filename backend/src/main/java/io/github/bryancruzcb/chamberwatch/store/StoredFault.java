package io.github.bryancruzcb.chamberwatch.store;

import java.util.Optional;

import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;
import io.github.bryancruzcb.chamberwatch.sim.FaultKind;
import io.github.bryancruzcb.chamberwatch.sim.InjectedFault;

/**
 * The fault stored beside a synthetic run, in the run's own seconds: the truth about the samples that are
 * actually in the database, whatever the simulator would draw for that run today.
 *
 * @param durationS the plan's duration, empty for a fault that lasted to the end of the etch; the ramp for a
 *                  reflected power rise
 */
public record StoredFault(FaultKind kind, ChannelName channel, double startS, double endS, Optional<Double> durationS,
		double magnitude) {

	/** Rounded to the precision the store keeps, so a fault just stored and one read back compare equal. */
	public static StoredFault of(InjectedFault fault) {
		double duration = fault.plan().durationS();
		return new StoredFault(fault.kind(), fault.channel(), (float) fault.startS(), (float) fault.endS(),
				Double.isFinite(duration) ? Optional.of((double) (float) duration) : Optional.empty(), fault.plan().magnitude());
	}

}
