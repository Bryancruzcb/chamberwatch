package io.github.bryancruzcb.chamberwatch.ingest;

import java.io.IOException;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.SortedMap;
import java.util.SortedSet;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.stream.Collectors;

import io.github.bryancruzcb.chamberwatch.detect.Baseline;
import io.github.bryancruzcb.chamberwatch.detect.ChannelVerdict;
import io.github.bryancruzcb.chamberwatch.detect.DetectorConfig;
import io.github.bryancruzcb.chamberwatch.detect.DriftProjection;
import io.github.bryancruzcb.chamberwatch.detect.Excursion;
import io.github.bryancruzcb.chamberwatch.detect.GoodRuns;
import io.github.bryancruzcb.chamberwatch.detect.HealthModel;
import io.github.bryancruzcb.chamberwatch.detect.Label;
import io.github.bryancruzcb.chamberwatch.detect.LotFit;
import io.github.bryancruzcb.chamberwatch.detect.RunAssessment;
import io.github.bryancruzcb.chamberwatch.detect.SummaryBand;
import io.github.bryancruzcb.chamberwatch.detect.SummaryStat;
import io.github.bryancruzcb.chamberwatch.recipe.AlignedRun;
import io.github.bryancruzcb.chamberwatch.recipe.Aligner;
import io.github.bryancruzcb.chamberwatch.recipe.AlignmentStatus;
import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;
import io.github.bryancruzcb.chamberwatch.recipe.Phase;
import io.github.bryancruzcb.chamberwatch.recipe.PhaseSummary;
import io.github.bryancruzcb.chamberwatch.recipe.RecipePosition;
import io.github.bryancruzcb.chamberwatch.recipe.RunKey;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Runs the detectors on the 96 public wafers and pins what they find. The data is never committed, so
 * this runs only where it has been downloaded, and CI skips it. The tables behind docs/DATA.md are
 * written to target/public-calibration.txt and target/public-scoring.txt.
 */
@EnabledIf("publicDataPresent")
class PublicDataDetectionTest {

	private static final Path DATA = Path.of("../data/public/zenodo17122442");

	private static final Path MD5_LIST = Path.of("../docs/zenodo17122442.md5");

	private static final ChannelName TUNING_CAPACITOR = ChannelName.of("PlatenRFTuningCapacitor");

	private static final ChannelName LOAD_CAPACITOR = ChannelName.of("PlatenRFLoadCapacitor");

	private static final DetectorConfig CONFIG = DetectorConfig.defaults();

	private static SortedMap<RunKey, AlignedRun> runs;

	static boolean publicDataPresent() {
		return Files.exists(DATA.resolve(AlignCommand.PROCESS_DATA));
	}

	@BeforeAll
	static void alignEveryWafer() {
		Map<String, DataFiles.VerifiedFile> files = DataFiles.verify(DATA, MD5_LIST,
				List.of(AlignCommand.PROCESS_DATA, AlignCommand.DICTIONARY));
		runs = new TreeMap<>();
		try (NetcdfTelemetrySource source = NetcdfTelemetrySource.open(files.get(AlignCommand.PROCESS_DATA),
				files.get(AlignCommand.DICTIONARY))) {
			for (RunKey key : source.keys()) {
				runs.put(key, Aligner.STANDARD.align(source.read(key)).orElseThrow());
			}
		}
	}

	@Test
	void goodWafersScoredWithoutTheirOwnLotRarelyAlarmAtTheDefaults() throws IOException {
		SortedMap<RunKey, RunAssessment> firstThree = heldOut(1, 3);
		SortedMap<RunKey, RunAssessment> secondToFourth = heldOut(2, 4);
		SortedMap<RunKey, RunAssessment> firstTwo = heldOut(1, 2);
		try (PrintStream out = report("public-calibration.txt")) {
			calibration(out, "good runs = wafers 1 to 3", firstThree);
			calibration(out, "good runs = wafers 2 to 4", secondToFourth);
			calibration(out, "good runs = wafers 1 to 2", firstTwo);
			out.println("full scoring with the first 2 wafers of each lot as the good runs");
			scoredWith(2).values().forEach((assessment) -> out.println(describe(assessment, Set.of())));
		}

		assertThat(alarmsAbove(firstThree, 3.0)).hasSize(23);
		assertThat(alarmsAbove(firstThree, CONFIG.limit().k())).containsExactly(
				RunKey.ofPublicGroup("Day_2024_07_05_Wafer_01"), RunKey.ofPublicGroup("Day_2024_08_21_Wafer_01"));
		assertThat(firstThree.values()).allSatisfy((assessment) -> {
			assertThat(assessment.deviationFlags()).isZero();
			if (assessment.flagged()) {
				assertThat(assessment.firstChannel().orElseThrow()).isIn(TUNING_CAPACITOR, LOAD_CAPACITOR);
			}
		});
		assertThat(alarmsAbove(secondToFourth, CONFIG.limit().k())).hasSize(2);
		// two good wafers per lot alarm no less on held-out wafers, the same two, and the tighter summary bands
		// then flag half the public wafers as run-level deviations, so three stays the default
		assertThat(alarmsAbove(firstTwo, 3.0)).hasSize(14);
		assertThat(alarmsAbove(firstTwo, CONFIG.limit().k())).containsExactlyElementsOf(alarmsAbove(firstThree, CONFIG.limit().k()));
		assertThat(scoredWith(2).values().stream().filter(RunAssessment::flagged)).hasSize(49);
	}

	@Test
	void theDefaultsFlagLateWafersOnThePlatenMatchCapacitorsOnly() throws IOException {
		SortedSet<RunKey> good = GoodRuns.select(runs.values()
			.stream()
			.map((run) -> new GoodRuns.Candidate(run.key(), Label.AUTO, run.report().status() == AlignmentStatus.ALIGNED))
			.toList(), CONFIG.goodRunsPerLot());
		Baseline baseline = HealthModel.fit(good.stream().map(runs::get), CONFIG);
		SortedMap<RunKey, RunAssessment> assessments = new TreeMap<>();
		runs.values().forEach((run) -> assessments.put(run.key(), HealthModel.assess(run, baseline)));
		SortedMap<LocalDate, DriftProjection.State> tuningDrift = drift(baseline, TUNING_CAPACITOR);
		try (PrintStream out = report("public-scoring.txt")) {
			assessments.values().forEach((assessment) -> out.println(describe(assessment, good)));
			out.println();
			out.println("drift of the SF6 phase mean as of each lot's last wafer: state(t)");
			for (ChannelName channel : baseline.informativeChannels()) {
				out.println(driftLine(baseline, channel));
			}
		}

		assertThat(assessments.values().stream().filter(RunAssessment::flagged).map((a) -> a.run().value()))
			.containsExactly("Day_2024_08_01_Wafer_04", "Day_2024_08_01_Wafer_05", "Day_2024_08_01_Wafer_06",
					"Day_2024_08_01_Wafer_07", "Day_2024_08_01_Wafer_08", "Day_2024_08_01_Wafer_09",
					"Day_2024_08_01_Wafer_10", "Day_2024_08_05_Wafer_04", "Day_2024_08_05_Wafer_05",
					"Day_2024_08_05_Wafer_06", "Day_2024_08_07_Wafer_07", "Day_2024_08_21_Wafer_07",
					"Day_2024_08_21_Wafer_08", "Day_2024_08_21_Wafer_09", "Day_2024_08_21_Wafer_10");
		assertThat(assessments.values()).allSatisfy((assessment) -> {
			assertThat(assessment.deviationFlags()).isZero();
			if (assessment.flagged()) {
				assertThat(assessment.firstChannel().orElseThrow()).isIn(TUNING_CAPACITOR, LOAD_CAPACITOR);
			}
		});
		// the irregular cycle 74 moves pressure for a moment, too briefly for the persistence rule
		assertThat(assessments.get(RunKey.ofPublicGroup("Day_2024_07_09_Wafer_07")).verdict(ChannelName.of("Pressure"))
			.persistentZ()).isBetween(4.0, 5.0);
		assertThat(tuningDrift).hasSize(10).allSatisfy((lot, state) -> assertThat(state).isEqualTo(DriftProjection.State.OUT_OF_BAND));
	}

	@Test
	void theStuckRuleLearnedFromGoodWafersRarelyFiresOnHeldOutOnes() throws IOException {
		// per held-out good wafer and channel: the longest hold it showed, and the longest hold the other lots'
		// good wafers showed, which is what the rule compares it with
		record Pair(RunKey run, ChannelName channel, int held, int reference) {
		}
		List<Pair> pairs = new ArrayList<>();
		SortedSet<RunKey> good = new TreeSet<>(runs.keySet().stream().filter((key) -> key.positionInLot() <= 3).toList());
		for (List<RunKey> lot : byLot(good).values()) {
			Baseline baseline = HealthModel.fit(good.stream().filter((key) -> !lot.contains(key)).map(runs::get), CONFIG);
			for (RunKey key : lot) {
				for (ChannelVerdict verdict : HealthModel.assess(runs.get(key), baseline).verdicts()) {
					pairs.add(new Pair(key, verdict.channel(), verdict.longestHold(),
							baseline.band(verdict.channel()).orElseThrow().maxHold()));
				}
			}
		}
		DetectorConfig.StuckRule rule = CONFIG.stuck();
		SortedMap<RunKey, RunAssessment> everyWafer = scoredWith(CONFIG.goodRunsPerLot());
		try (PrintStream out = report("public-stuck.txt")) {
			out.println("held-out good wafers with a hold longer than the factor times the other lots' longest, and at least "
					+ rule.minSamples() + " samples");
			out.println("factor  wafers of 30  channel-wafers");
			for (double factor : new double[] { 1.0, 1.25, 1.5, 2.0, 3.0 }) {
				List<Pair> over = pairs.stream()
					.filter((pair) -> pair.held() >= rule.minSamples() && pair.held() > factor * pair.reference())
					.toList();
				out.printf(Locale.ROOT, "%.2f  %d  %d  %s%n", factor, over.stream().map(Pair::run).distinct().count(),
						over.size(), over.stream()
							.map((pair) -> pair.run().value() + ":" + pair.channel() + "=" + pair.held() + "/" + pair.reference())
							.collect(Collectors.joining(" ")));
			}
			out.println();
			out.println("longest hold per channel over the 30 good wafers, in samples, and over all 96 wafers");
			Baseline all = HealthModel.fit(good.stream().map(runs::get), CONFIG);
			for (ChannelName channel : all.informativeChannels()) {
				int everyMax = everyWafer.values()
					.stream()
					.mapToInt((assessment) -> assessment.verdict(channel).longestHold())
					.max()
					.orElse(0);
				out.printf(Locale.ROOT, "%s good=%d all=%d%n", channel, all.band(channel).orElseThrow().maxHold(), everyMax);
			}
			out.println();
			out.println("public wafers with a stuck flag at the defaults");
			everyWafer.values()
				.stream()
				.filter((assessment) -> assessment.stuckFlags() > 0)
				.forEach((assessment) -> out.println(describe(assessment, Set.of())));
		}

		long heldOutAlarms = pairs.stream()
			.filter((pair) -> pair.held() >= rule.minSamples() && pair.held() > rule.factor() * pair.reference())
			.map(Pair::run)
			.distinct()
			.count();
		assertThat(heldOutAlarms).isZero();
		// two late wafers of lot 6 hold the platen load capacitor for 22 and 12 samples where no good run holds it
		// past 3: the match network stopped moving, on wafers the limit detector already flags on the same channel
		Map<String, Integer> stuck = new TreeMap<>();
		everyWafer.values().stream().filter((assessment) -> assessment.stuckFlags() > 0).forEach((assessment) -> {
			assertThat(assessment.verdicts().stream().filter((v) -> !v.holds().isEmpty()).map(ChannelVerdict::channel))
				.containsExactly(LOAD_CAPACITOR);
			stuck.put(assessment.run().value(), assessment.verdict(LOAD_CAPACITOR).longestHold());
		});
		assertThat(stuck).containsExactly(Map.entry("Day_2024_08_01_Wafer_06", 22), Map.entry("Day_2024_08_01_Wafer_10", 12));
	}

	/** Every wafer scored against a baseline fitted on the first {@code perLot} wafers of each lot. */
	private static SortedMap<RunKey, RunAssessment> scoredWith(int perLot) {
		SortedSet<RunKey> good = GoodRuns.select(runs.values()
			.stream()
			.map((run) -> new GoodRuns.Candidate(run.key(), Label.AUTO, run.report().status() == AlignmentStatus.ALIGNED))
			.toList(), perLot);
		Baseline baseline = HealthModel.fit(good.stream().map(runs::get), CONFIG);
		SortedMap<RunKey, RunAssessment> assessments = new TreeMap<>();
		runs.values().forEach((run) -> assessments.put(run.key(), HealthModel.assess(run, baseline)));
		return assessments;
	}

	/** Each good run scored against a baseline fitted on the good runs of the other lots. */
	private static SortedMap<RunKey, RunAssessment> heldOut(int fromPosition, int toPosition) {
		SortedSet<RunKey> good = new TreeSet<>(runs.keySet()
			.stream()
			.filter((key) -> key.positionInLot() >= fromPosition && key.positionInLot() <= toPosition)
			.toList());
		SortedMap<RunKey, RunAssessment> assessments = new TreeMap<>();
		for (List<RunKey> lot : byLot(good).values()) {
			Baseline baseline = HealthModel.fit(good.stream().filter((key) -> !lot.contains(key)).map(runs::get), CONFIG);
			lot.forEach((key) -> assessments.put(key, HealthModel.assess(runs.get(key), baseline)));
		}
		return assessments;
	}

	private static List<RunKey> alarmsAbove(Map<RunKey, RunAssessment> assessments, double k) {
		return assessments.values()
			.stream()
			.filter((assessment) -> assessment.maxPersistentZ() > k)
			.map(RunAssessment::run)
			.toList();
	}

	private static void calibration(PrintStream out, String title, SortedMap<RunKey, RunAssessment> assessments) {
		out.println(title + ", each scored against a baseline fitted without its own lot");
		out.println("threshold  limit alarms (persistent |z| > k)  run-level alarms (summary |z| > z)");
		for (int threshold = 3; threshold <= 8; threshold++) {
			double t = threshold;
			out.printf(Locale.ROOT, "%d  %d of %d  %d of %d%n", threshold, alarmsAbove(assessments, t).size(),
					assessments.size(),
					assessments.values()
						.stream()
						.filter((a) -> a.verdicts().stream().anyMatch((v) -> v.maxAbsSummaryZ() > t))
						.count(),
					assessments.size());
		}
		for (RunAssessment assessment : assessments.values()) {
			out.printf(Locale.ROOT, "  %s %s | %s%n", assessment.run().value(),
					largest(assessment, ChannelVerdict::persistentZ), largest(assessment, ChannelVerdict::maxAbsSummaryZ));
		}
		out.println();
	}

	private static String largest(RunAssessment assessment, java.util.function.ToDoubleFunction<ChannelVerdict> metric) {
		return assessment.verdicts()
			.stream()
			.max(Comparator.comparingDouble(metric))
			.map((v) -> String.format(Locale.ROOT, "%s=%.1f", v.channel(), metric.applyAsDouble(v)))
			.orElse("-");
	}

	private static SortedMap<LocalDate, DriftProjection.State> drift(Baseline baseline, ChannelName channel) {
		SortedMap<LocalDate, DriftProjection.State> states = new TreeMap<>();
		SummaryBand band = baseline.summaryBands().band(channel, Phase.SF6, SummaryStat.MEAN).orElseThrow();
		for (Map.Entry<LocalDate, List<RunKey>> lot : byLot(runs.keySet()).entrySet()) {
			states.put(lot.getKey(), HealthModel.project(lotFit(lot.getValue(), channel), band, CONFIG.drift()).state());
		}
		return states;
	}

	private static String driftLine(Baseline baseline, ChannelName channel) {
		StringBuilder line = new StringBuilder(channel.value());
		SummaryBand band = baseline.summaryBands().band(channel, Phase.SF6, SummaryStat.MEAN).orElse(null);
		if (band == null) {
			return line.append(" no band").toString();
		}
		for (Map.Entry<LocalDate, List<RunKey>> lot : byLot(runs.keySet()).entrySet()) {
			LotFit fit = lotFit(lot.getValue(), channel);
			DriftProjection projection = HealthModel.project(fit, band, CONFIG.drift());
			line.append(String.format(Locale.ROOT, "  %s:%s(%.1f)", lot.getKey().toString().substring(5), projection.state(),
					fit.tStat()));
		}
		return line.toString();
	}

	private static LotFit lotFit(List<RunKey> lot, ChannelName channel) {
		return LotFit.of(lot.stream()
			.flatMap((key) -> runs.get(key)
				.summaries()
				.stream()
				.filter((summary) -> summary.channel().equals(channel) && summary.phase() == Phase.SF6)
				.map((PhaseSummary summary) -> new LotFit.Point(key.positionInLot(), summary.mean())))
			.sorted(Comparator.comparingInt(LotFit.Point::position))
			.toList());
	}

	private static SortedMap<LocalDate, List<RunKey>> byLot(Set<RunKey> keys) {
		return keys.stream()
			.collect(Collectors.groupingBy((key) -> key.day().orElseThrow(), TreeMap::new, Collectors.toList()));
	}

	private static String describe(RunAssessment assessment, Set<RunKey> good) {
		AlignedRun run = runs.get(assessment.run());
		StringBuilder line = new StringBuilder(String.format(Locale.ROOT, "%s%s limit=%d dev=%d persistentZ=%.1f",
				assessment.run().value(), good.contains(assessment.run()) ? " GOOD" : "", assessment.limitFlags(),
				assessment.deviationFlags(), assessment.maxPersistentZ()));
		for (ChannelVerdict verdict : assessment.verdicts()) {
			if (!verdict.flagged()) {
				break;
			}
			line.append(" | ").append(verdict.channel());
			for (Excursion excursion : verdict.excursions().subList(0, Math.min(2, verdict.excursions().size()))) {
				RecipePosition start = run.grid().position(excursion.startSlot());
				line.append(String.format(Locale.ROOT, " c%d.%s+%d t=%.1fs n=%d z=%.1f", start.cycle(), start.phase(),
						start.offset(), run.timeAt(excursion.startSlot()), excursion.outSamples(), excursion.peakZ()));
			}
			if (verdict.excursions().size() > 2) {
				line.append(" (+").append(verdict.excursions().size() - 2).append(')');
			}
		}
		return line.toString();
	}

	private static PrintStream report(String name) throws IOException {
		return new PrintStream(Files.newOutputStream(Path.of("target", name)), true, StandardCharsets.UTF_8);
	}

}
