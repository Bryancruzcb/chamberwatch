package io.github.bryancruzcb.chamberwatch.detect;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.OptionalInt;
import java.util.stream.Stream;

import io.github.bryancruzcb.chamberwatch.recipe.AlignedRun;
import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;
import io.github.bryancruzcb.chamberwatch.recipe.PhaseSummary;

/**
 * The public surface of the detect package: learn a baseline, score a run, project a lot. Three pure
 * functions over domain types. The same calls score public wafers and synthetic runs.
 *
 * <p>Behind them: streaming band learning with pooled variance and floors, channel roles, the k-sigma
 * persistence rule with gap resets, run-level z-scores, first-channel ranking, and drift projection.
 */
public final class HealthModel {

	/** Bump when band learning or scoring changes, so stored baselines are fitted and scored again. */
	public static final int VERSION = 1;

	private HealthModel() {
	}

	/**
	 * Learns a baseline from good runs, holding one run at a time.
	 *
	 * @throws IllegalArgumentException when the stream is empty, repeats a run, or mixes grids
	 */
	public static Baseline fit(Stream<AlignedRun> goodRuns, DetectorConfig config) {
		BaselineFitter[] fitter = new BaselineFitter[1];
		goodRuns.forEachOrdered((run) -> {
			if (fitter[0] == null) {
				fitter[0] = new BaselineFitter(run.grid(), config);
			}
			fitter[0].add(run);
		});
		if (fitter[0] == null) {
			throw new IllegalArgumentException("a baseline needs at least one good run");
		}
		return fitter[0].finish();
	}

	/**
	 * Scores one run: limit excursions and run-level z-scores for every informative channel the run
	 * carries, ranked. A channel the run lacks is absent from the result, never anomalous.
	 *
	 * @throws IllegalArgumentException when the run's grid differs from the baseline's
	 */
	public static RunAssessment assess(AlignedRun run, Baseline baseline) {
		if (!run.grid().equals(baseline.grid())) {
			throw new IllegalArgumentException(run.key().value() + " is on a different grid than the baseline");
		}
		Map<ChannelName, List<PhaseSummary>> summaries = new HashMap<>();
		for (PhaseSummary summary : run.summaries()) {
			summaries.computeIfAbsent(summary.channel(), (name) -> new ArrayList<>()).add(summary);
		}
		List<Ranking.ChannelFindings> findings = new ArrayList<>();
		for (ChannelName channel : baseline.informativeChannels()) {
			int index = run.channels().indexOf(channel);
			if (index < 0) {
				continue;
			}
			LimitDetector.Scan scan = LimitDetector.scan(run, index, baseline.band(channel).orElseThrow(),
					baseline.config().limit());
			findings.add(new Ranking.ChannelFindings(channel, scan.excursions(), scan.persistentZ(),
					RunDeviation.score(channel, summaries.getOrDefault(channel, List.of()), baseline.summaryBands())));
		}
		return new RunAssessment(run.key(), Ranking.rank(findings, baseline.config().runZ()));
	}

	/**
	 * Judges one channel's trend across a lot against the good-run band of its SF6 phase mean.
	 * Order of checks: too few wafers, already outside the band, no significant trend, then where the
	 * fitted line meets the band edge.
	 */
	public static DriftProjection project(LotFit fit, SummaryBand band, DetectorConfig.DriftRule rule) {
		int asOf = fit.asOfPosition();
		if (fit.runs() < rule.minRuns()) {
			return new DriftProjection(asOf, DriftProjection.State.INSUFFICIENT_RUNS, OptionalInt.empty(),
					OptionalInt.empty());
		}
		double low = band.low(rule.k());
		double high = band.high(rule.k());
		double now = fit.valueAt(asOf);
		if (now < low || now > high) {
			return new DriftProjection(asOf, DriftProjection.State.OUT_OF_BAND, OptionalInt.of(asOf), OptionalInt.of(0));
		}
		if (fit.slope() == 0 || !(Math.abs(fit.tStat()) >= rule.minAbsT())) {
			return new DriftProjection(asOf, DriftProjection.State.NO_TREND, OptionalInt.empty(), OptionalInt.empty());
		}
		double edge = (fit.slope() > 0) ? high : low;
		double exit = (edge - fit.intercept()) / fit.slope();
		int firstOut = (int) Math.floor(exit) + 1;
		if (firstOut <= rule.plannedLotSize()) {
			return new DriftProjection(asOf, DriftProjection.State.WILL_EXIT, OptionalInt.of(firstOut),
					OptionalInt.of(Math.max(0, firstOut - asOf - 1)));
		}
		return new DriftProjection(asOf, DriftProjection.State.STAYS_IN, OptionalInt.empty(), OptionalInt.empty());
	}

}
