package io.github.bryancruzcb.chamberwatch.detect;

/**
 * Every tunable of the detectors, as plain values.
 *
 * @param band           how bands are learned
 * @param limit          the k-sigma persistence rule
 * @param runZ           a channel deviates at run level when its largest summary |z| exceeds this, 5.0
 * @param drift          how lot drift is judged
 * @param goodRunsPerLot by default the first this many wafers of each lot are good runs, 3
 */
public record DetectorConfig(BandRule band, LimitRule limit, double runZ, DriftRule drift, int goodRunsPerLot) {

	public DetectorConfig {
		if (band == null || limit == null || drift == null || !(runZ > 0) || goodRunsPerLot < 1) {
			throw new IllegalArgumentException("invalid detector config");
		}
	}

	/** The limit and run-level thresholds come from held-out good wafers of the public data; see docs/DATA.md. */
	public static DetectorConfig defaults() {
		return new DetectorConfig(BandRule.DEFAULT, LimitRule.DEFAULT, 5.0, DriftRule.DEFAULT, 3);
	}

	/**
	 * @param poolHalfWidthCycles variance is pooled over this many steady cycles on either side, at the same phase and offset, 2
	 * @param relativeSdFloor     a band's sd is at least this share of the channel's median pooled sd, 0.05
	 * @param minObservations     a slot with fewer pooled observations gets no band, 5
	 * @param maxDistinctTracked  distinct good-run values tracked per channel to find its resolution, 4096
	 */
	public record BandRule(int poolHalfWidthCycles, double relativeSdFloor, int minObservations, int maxDistinctTracked) {

		public static final BandRule DEFAULT = new BandRule(2, 0.05, 5, 4096);

		public BandRule {
			if (poolHalfWidthCycles < 0 || relativeSdFloor < 0 || relativeSdFloor >= 1 || minObservations < 2
					|| maxDistinctTracked < 2) {
				throw new IllegalArgumentException("invalid band rule");
			}
		}

	}

	/**
	 * Flag a channel that stays outside {@code mean +/- k * sd} for {@code n} consecutive samples.
	 *
	 * @param k band half-width in standard deviations, 6.0
	 * @param n consecutive out-of-band samples needed to confirm, 5, which is one second at 5 Hz
	 */
	public record LimitRule(double k, int n) {

		public static final LimitRule DEFAULT = new LimitRule(6.0, 5);

		public LimitRule {
			if (!(k > 0) || n < 1) {
				throw new IllegalArgumentException("invalid limit rule");
			}
		}

	}

	/**
	 * @param k              drift band half-width, in good-run standard deviations of the SF6 phase mean, 3.0
	 * @param minRuns        fewest wafers before a trend is judged, 4
	 * @param minAbsT        slopes with a smaller |t| are no trend, 2.5
	 * @param plannedLotSize how far ahead the projection looks, 10 wafers
	 */
	public record DriftRule(double k, int minRuns, double minAbsT, int plannedLotSize) {

		public static final DriftRule DEFAULT = new DriftRule(3.0, 4, 2.5, 10);

		public DriftRule {
			if (!(k > 0) || minRuns < 3 || !(minAbsT > 0) || plannedLotSize < minRuns) {
				throw new IllegalArgumentException("invalid drift rule");
			}
		}

	}

}
