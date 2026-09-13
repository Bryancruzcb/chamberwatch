package io.github.bryancruzcb.chamberwatch.store;

/** The two measurement campaigns. They disagree by about 3 micrometres on mean depth, so nothing mixes them. */
public enum MeasurementSet {

	/** Measured on the day at 9 named locations. There is no data for lots 8 and 10. */
	NINE_POINT,

	/** Measured again months later, with other instruments, at 89 locations. */
	EIGHTY_NINE_POINT

}
