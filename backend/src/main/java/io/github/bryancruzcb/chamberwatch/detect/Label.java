package io.github.bryancruzcb.chamberwatch.detect;

/** An engineer's judgement of a run. Only {@link GoodRuns} interprets it. */
public enum Label {

	/** No judgement: the default good-run policy decides. */
	AUTO,

	/** Always a good run, wherever it sits in its lot. */
	GOOD,

	/** Never a good run. */
	BAD

}
