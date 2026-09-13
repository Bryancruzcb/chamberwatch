package io.github.bryancruzcb.chamberwatch.recipe;

/**
 * The thresholds that turn the gas flows and the source power into phase onsets. The numbers come
 * from the public data, described in docs/DATA.md. The gap threshold lives in
 * {@link RecipeGrid#gapStepSeconds()}.
 *
 * @param sf6Marker          channel that marks SF6 phases, Gas5Flow
 * @param sf6OnLevel         SF6 is on at or above this flow, 300, half the setpoint
 * @param c4f8Marker         channel that marks C4F8 phases, Gas4Flow
 * @param c4f8OnLevel        C4F8 is on at or above this flow while SF6 is off, 150
 * @param powerMarker        channel that shows the plasma running at etch power, SourceRFLoadPower
 * @param powerOnLevel       etch power is at or above this, 1000; a plasma strike runs near 140
 * @param minHotFraction     a gas stretch counts only when at least this share of its samples are at etch power, 0.5
 * @param c4f8Seconds        how long a C4F8 phase lasts, 0.6 to 2.2 s; the 11.8 s stabilization step is longer
 * @param sf6MinSamples      SF6-on stretches shorter than this are glitches, 2
 * @param cycle1LeadGapS     a cycle 1 SF6 phase ends at most this long before C4F8 phase 1, 0.6 s
 * @param lockWindowS        an onset seen this close to the expected time is accepted, 1.0 s
 * @param initialSf6ToC4f8S  SF6 onset to C4F8 onset before any cycle has been measured, 4.5 s
 * @param initialC4f8ToSf6S  C4F8 onset to the next SF6 onset before any cycle has been measured, 1.5 s
 * @param medianOf           measured intervals in the running median, 5
 * @param trailingSamples    samples after the last phase's flow drops that still belong to that phase, 1
 * @param regularSf6ToC4f8S  usual SF6 onset to C4F8 onset in a steady cycle, 4.2 to 4.8 s
 * @param regularC4f8ToSf6S  usual C4F8 onset to the next SF6 onset, 1.2 to 1.8 s
 */
public record MarkerRules(ChannelName sf6Marker, double sf6OnLevel, ChannelName c4f8Marker, double c4f8OnLevel,
		ChannelName powerMarker, double powerOnLevel, double minHotFraction, Range c4f8Seconds, int sf6MinSamples,
		double cycle1LeadGapS, double lockWindowS, double initialSf6ToC4f8S, double initialC4f8ToSf6S, int medianOf,
		int trailingSamples, Range regularSf6ToC4f8S, Range regularC4f8ToSf6S) {

	public static final MarkerRules STANDARD = new MarkerRules(ChannelName.GAS5_FLOW, 300, ChannelName.GAS4_FLOW, 150,
			ChannelName.SOURCE_RF_LOAD_POWER, 1000, 0.5, new Range(0.6, 2.2), 2, 0.6, 1.0, 4.5, 1.5, 5, 1,
			new Range(4.2, 4.8), new Range(1.2, 1.8));

	public MarkerRules {
		if (!(lockWindowS > 0) || medianOf < 1 || sf6MinSamples < 1 || trailingSamples < 0
				|| !(minHotFraction > 0 && minHotFraction <= 1)) {
			throw new IllegalArgumentException("invalid marker rules");
		}
	}

	/** An inclusive range, with a micro-second of slack for sample-time rounding. */
	public record Range(double min, double max) {

		public Range {
			if (!(min <= max)) {
				throw new IllegalArgumentException("empty range " + min + " to " + max);
			}
		}

		public boolean contains(double value) {
			return value >= min - 1e-6 && value <= max + 1e-6;
		}

	}

}
