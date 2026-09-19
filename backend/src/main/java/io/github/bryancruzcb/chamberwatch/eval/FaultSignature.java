package io.github.bryancruzcb.chamberwatch.eval;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;

import io.github.bryancruzcb.chamberwatch.detect.ChannelVerdict;
import io.github.bryancruzcb.chamberwatch.detect.Excursion;
import io.github.bryancruzcb.chamberwatch.detect.Hold;
import io.github.bryancruzcb.chamberwatch.detect.RunAssessment;
import io.github.bryancruzcb.chamberwatch.recipe.AlignedRun;
import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;
import io.github.bryancruzcb.chamberwatch.sim.FaultKind;

/**
 * Names the fault kind a run's findings look like, without knowing the truth, so precision can be counted
 * per kind. The first departure, in rank order and then in slot order, that fits a kind's pattern decides:
 * a gas flow reading low, the pressure or the reflected source power reading high, a dropout channel
 * reading exactly 0, or a sensor channel holding one value.
 */
public final class FaultSignature {

	private FaultSignature() {
	}

	public static Optional<FaultKind> of(RunAssessment assessment, AlignedRun run) {
		for (ChannelVerdict verdict : assessment.verdicts()) {
			for (Departure departure : departures(verdict)) {
				Optional<FaultKind> kind = departure.kind(verdict.channel(), run);
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

	static Optional<FaultKind> match(ChannelName channel, Hold hold) {
		return FaultKind.SENSOR_STUCK.channels().contains(channel) ? Optional.of(FaultKind.SENSOR_STUCK) : Optional.empty();
	}

	/** A channel's excursions and holds together, earliest first. */
	private static List<Departure> departures(ChannelVerdict verdict) {
		List<Departure> departures = new ArrayList<>();
		verdict.excursions().forEach((excursion) -> departures.add(new Departure(excursion.startSlot(), excursion, null)));
		verdict.holds().forEach((hold) -> departures.add(new Departure(hold.startSlot(), null, hold)));
		departures.sort(Comparator.comparingInt(Departure::startSlot));
		return departures;
	}

	private record Departure(int startSlot, Excursion excursion, Hold hold) {

		Optional<FaultKind> kind(ChannelName channel, AlignedRun run) {
			return (excursion != null) ? match(channel, excursion, run) : match(channel, hold);
		}

	}

}
