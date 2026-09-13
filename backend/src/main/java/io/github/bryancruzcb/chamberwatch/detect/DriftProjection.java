package io.github.bryancruzcb.chamberwatch.detect;

import java.util.OptionalInt;

/**
 * What the drift detector says about one channel of one lot, as of one wafer.
 *
 * @param firstOutPosition the first wafer position whose fitted value lies outside the band
 * @param runsRemaining    wafers after the as-of position that still fit inside the band
 */
public record DriftProjection(int asOfPosition, State state, OptionalInt firstOutPosition, OptionalInt runsRemaining) {

	public enum State {

		/** Fewer wafers so far than the drift rule needs. */
		INSUFFICIENT_RUNS,

		/** The fitted value at the as-of wafer is already outside the band. */
		OUT_OF_BAND,

		/** The slope's |t| is below the drift rule's threshold. */
		NO_TREND,

		/** The fitted line leaves the band within the planned lot size. */
		WILL_EXIT,

		/** The fitted line stays inside the band through the planned lot size. */
		STAYS_IN

	}

}
