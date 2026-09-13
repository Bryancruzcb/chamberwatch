package io.github.bryancruzcb.chamberwatch.sim;

/** How an etch begins. The public wafers use all three: 65, 10 and 21 of 96. */
public enum EtchStart {

	/** A 2.8 s SF6 phase right before C4F8 phase 1. */
	SHORT_SF6,

	/** A full-length SF6 phase, 4.2 to 4.4 s, right before C4F8 phase 1. */
	FULL_SF6,

	/** No SF6 phase before C4F8 phase 1, after a low-power plasma strike. */
	C4F8

}
