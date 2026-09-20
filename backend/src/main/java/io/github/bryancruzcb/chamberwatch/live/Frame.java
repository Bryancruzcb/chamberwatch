package io.github.bryancruzcb.chamberwatch.live;

import java.util.List;
import java.util.Optional;

import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;
import io.github.bryancruzcb.chamberwatch.recipe.RunKey;
import io.github.bryancruzcb.chamberwatch.sim.FaultKind;

/**
 * One line the chamber simulator sent. Every kind it can send is a record here, so a reader handles them by
 * pattern matching and the compiler checks that none was forgotten.
 */
public sealed interface Frame {

	/** The first line of a connection: which wafer is being etched and what its channels are called. */
	record Hello(RunKey key, long seed, int lot, int wafer, double periodS, List<ChannelName> channels)
			implements Frame {

		public Hello {
			channels = List.copyOf(channels);
		}

	}

	/**
	 * One tick of the etch.
	 *
	 * @param values one reading per channel, in the order the hello named them
	 */
	record Sample(int tick, double timeS, String state, int cycle, float[] values) implements Frame {

		public Sample {
			values = values.clone();
		}

		public float[] values() {
			return values.clone();
		}

	}

	/** The answer to a command, whether it was taken or refused. */
	record Ack(String command, int tick, boolean accepted, Optional<String> refused, Optional<String> detail)
			implements Frame {
	}

	/** The last line: the run is over, and what was put into it. */
	record End(String reason, int samples, Optional<StreamedFault> fault) implements Frame {

		public boolean complete() {
			return "COMPLETE".equals(reason);
		}

	}

	/** The simulator refused the connection itself, for instance because it is already busy. */
	record Failure(String reason) implements Frame {
	}

	/** A line whose type this version does not know, kept rather than thrown so a newer simulator still works. */
	record Unknown(String type) implements Frame {
	}

	/**
	 * A fault the simulator put into the run, as the end frame reports it.
	 *
	 * @param durationS empty when it lasted to the end of the etch
	 */
	record StreamedFault(FaultKind kind, ChannelName channel, double startS, Optional<Double> durationS,
			double magnitude) {
	}

}
