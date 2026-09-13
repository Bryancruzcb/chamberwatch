package io.github.bryancruzcb.chamberwatch.sim;

import java.util.List;

import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;

/** The faults the simulator can inject, each on the channels it makes sense for. */
public enum FaultKind {

	/** A mass flow controller delivers a fraction of its flow from some moment to the end of the run. */
	GAS_FLOW_STUCK_LOW(List.of(ChannelName.GAS4_FLOW, ChannelName.GAS5_FLOW)),

	/** Chamber pressure jumps for a few seconds. */
	PRESSURE_SPIKE(List.of(ChannelName.of("Pressure"))),

	/** Reflected source power ramps up and stays up, as when the match network drifts off tune. */
	REFLECTED_POWER_RISE(List.of(ChannelName.of("SourceRFReflectedPower"))),

	/** A sensor reads 0 for a while. The process itself is untouched. */
	SENSOR_DROPOUT(List.of(ChannelName.of("ForeLinePressure"), ChannelName.of("HeliumBPPressure"),
			ChannelName.of("SourceRFPeakToPeak")));

	private final List<ChannelName> channels;

	FaultKind(List<ChannelName> channels) {
		this.channels = channels;
	}

	/** The channels this fault can be injected on, sorted by name. */
	public List<ChannelName> channels() {
		return channels;
	}

}
