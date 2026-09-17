package io.github.bryancruzcb.chamberwatch.detect;

/**
 * Where the drift band sits for a lot. Its width is always the good runs' spread; the reference sets its center.
 *
 * <p>On the public data no lot's first wafers sit outside the global band on any channel, the largest offset
 * being 2.3 standard deviations, so {@link #GLOBAL} is the default. {@link #LOT} answers a different question:
 * not whether the lot is where the good runs are, but whether it has moved from where it started.
 */
public enum DriftReference {

	/** The good runs' mean, learned from the first wafers of every lot. */
	GLOBAL,

	/** The mean of this lot's own first wafers, as many as the good-run policy takes per lot. */
	LOT

}
