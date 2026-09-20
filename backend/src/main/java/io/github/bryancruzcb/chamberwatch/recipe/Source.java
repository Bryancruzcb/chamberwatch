package io.github.bryancruzcb.chamberwatch.recipe;

/**
 * Where a run came from. A baseline never mixes them: bands learned from one generator would flag a run from
 * another for being different rather than for being faulty.
 */
public enum Source {

	/** A wafer the tool etched, from the public dataset. */
	PUBLIC,

	/** A wafer the Java simulator drew from a seed. */
	SYNTHETIC,

	/** A wafer streamed in as it was etched, by the C chamber simulator. */
	LIVE

}
