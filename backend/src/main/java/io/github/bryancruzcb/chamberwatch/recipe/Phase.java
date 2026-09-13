package io.github.bryancruzcb.chamberwatch.recipe;

/**
 * The two repeating steps of an etch cycle, in the order they appear in a cycle.
 *
 * <p>The dataset does not name its gas lines. Gas5Flow as SF6 and Gas4Flow as C4F8 is an inference
 * from flow level and duty cycle, so the gas names stay confined to this enum and {@link MarkerRules}.
 */
public enum Phase {

	/** Etch step, 4.2 to 4.4 s in steady cycles. Marked by Gas5Flow near 600. */
	SF6,

	/** Passivation step, 1.2 to 1.4 s. Marked by Gas4Flow near 300. */
	C4F8

}
