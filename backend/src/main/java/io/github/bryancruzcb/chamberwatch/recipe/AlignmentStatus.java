package io.github.bryancruzcb.chamberwatch.recipe;

/** Outcome of aligning one run. A run that could not be aligned at all is an {@link AlignmentResult.Failed}. */
public enum AlignmentStatus {

	/** Every phase onset was seen in the data, no gap falls inside the etch, and no steady-cycle sample overflowed. */
	ALIGNED,

	/** Scored, but never chosen as a good run automatically. The report's note says why. */
	DEGRADED

}
