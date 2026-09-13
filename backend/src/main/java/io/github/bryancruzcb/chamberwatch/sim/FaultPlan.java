package io.github.bryancruzcb.chamberwatch.sim;

import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;

/**
 * A fault to inject, planned before the run exists.
 *
 * @param startS    seconds after the etch starts
 * @param durationS how long the fault lasts, infinite for one that lasts to the end of the etch; for a
 *                  reflected power rise, the length of the ramp, after which the rise holds
 * @param magnitude the fraction of its normal flow a stuck gas still delivers, the pressure jump as a
 *                  fraction of the SF6 pressure, or the reflected power added in watts; 0 for a dropout
 */
public record FaultPlan(FaultKind kind, ChannelName channel, double startS, double durationS, double magnitude) {

	public FaultPlan {
		if (!kind.channels().contains(channel)) {
			throw new IllegalArgumentException(kind + " cannot be injected on " + channel);
		}
		if (!(startS >= 0) || !(durationS > 0)) {
			throw new IllegalArgumentException(kind + " needs a start at or after the etch start and a positive duration");
		}
		boolean validMagnitude = switch (kind) {
			case GAS_FLOW_STUCK_LOW -> magnitude > 0 && magnitude < 1;
			case PRESSURE_SPIKE, REFLECTED_POWER_RISE -> magnitude > 0 && Double.isFinite(magnitude);
			case SENSOR_DROPOUT -> magnitude == 0;
		};
		if (!validMagnitude) {
			throw new IllegalArgumentException(kind + " cannot have magnitude " + magnitude);
		}
	}

	/** The gas delivers {@code fraction} of its flow from {@code startS} to the end of the etch. */
	public static FaultPlan gasFlowStuckLow(ChannelName gas, double startS, double fraction) {
		return new FaultPlan(FaultKind.GAS_FLOW_STUCK_LOW, gas, startS, Double.POSITIVE_INFINITY, fraction);
	}

	public static FaultPlan pressureSpike(double startS, double durationS, double relativeRise) {
		return new FaultPlan(FaultKind.PRESSURE_SPIKE, FaultKind.PRESSURE_SPIKE.channels().get(0), startS, durationS,
				relativeRise);
	}

	public static FaultPlan reflectedPowerRise(double startS, double rampS, double watts) {
		return new FaultPlan(FaultKind.REFLECTED_POWER_RISE, FaultKind.REFLECTED_POWER_RISE.channels().get(0), startS,
				rampS, watts);
	}

	public static FaultPlan sensorDropout(ChannelName channel, double startS, double durationS) {
		return new FaultPlan(FaultKind.SENSOR_DROPOUT, channel, startS, durationS, 0);
	}

}
