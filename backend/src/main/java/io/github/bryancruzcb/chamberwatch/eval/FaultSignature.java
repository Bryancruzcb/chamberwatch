package io.github.bryancruzcb.chamberwatch.eval;

import java.util.Optional;

import io.github.bryancruzcb.chamberwatch.detect.ChannelVerdict;
import io.github.bryancruzcb.chamberwatch.detect.Excursion;
import io.github.bryancruzcb.chamberwatch.detect.RunAssessment;
import io.github.bryancruzcb.chamberwatch.recipe.AlignedRun;
import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;
import io.github.bryancruzcb.chamberwatch.sim.FaultKind;

/**
 * Names the fault kind a run's excursions look like, without knowing the truth, so precision can be counted
 * per kind. The first excursion, in rank order, that fits a kind's pattern decides: a gas flow reading low,
 * the pressure or the reflected source power reading high, or a dropout channel reading exactly 0.
 */
public final class FaultSignature {

	private FaultSignature() {
	}

	public static Optional<FaultKind> of(RunAssessment assessment, AlignedRun run) {
		for (ChannelVerdict verdict : assessment.verdicts()) {
			for (Excursion excursion : verdict.excursions()) {
				Optional<FaultKind> kind = match(verdict.channel(), excursion, run);
				if (kind.isPresent()) {
					return kind;
				}
			}
		}
		return Optional.empty();
	}

	static Optional<FaultKind> match(ChannelName channel, Excursion excursion, AlignedRun run) {
		boolean low = excursion.direction() == Excursion.Direction.LOW;
		if (low && FaultKind.GAS_FLOW_STUCK_LOW.channels().contains(channel)) {
			return Optional.of(FaultKind.GAS_FLOW_STUCK_LOW);
		}
		if (!low && FaultKind.PRESSURE_SPIKE.channels().contains(channel)) {
			return Optional.of(FaultKind.PRESSURE_SPIKE);
		}
		if (!low && FaultKind.REFLECTED_POWER_RISE.channels().contains(channel)) {
			return Optional.of(FaultKind.REFLECTED_POWER_RISE);
		}
		if (low && FaultKind.SENSOR_DROPOUT.channels().contains(channel)
				&& run.value(run.channels().indexOf(channel), excursion.confirmSlot()) == 0f) {
			return Optional.of(FaultKind.SENSOR_DROPOUT);
		}
		return Optional.empty();
	}

}
