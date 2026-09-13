package io.github.bryancruzcb.chamberwatch.detect;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.SplittableRandom;
import java.util.stream.IntStream;
import java.util.stream.Stream;

import io.github.bryancruzcb.chamberwatch.recipe.AlignedRun;
import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;
import io.github.bryancruzcb.chamberwatch.recipe.Phase;
import io.github.bryancruzcb.chamberwatch.recipe.RunKey;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;
import static org.assertj.core.api.Assertions.within;

class HealthModelTest {

	private static final ChannelName PRESSURE = ChannelName.of("Pressure");

	private static final ChannelName PLATEN_POWER = ChannelName.of("PlatenRFLoadPower");

	private static final ChannelName GAS1_FLOW = ChannelName.of("Gas1Flow");

	private static final ChannelName HEATER = ChannelName.of("Heater1Temp");

	private static final double PRESSURE_SD = 0.0005;

	private static final double POWER_SD = 0.3;

	/** Gas1Flow reads in steps of this size, and only moves during C4F8. */
	private static final float GAS1_STEP = 0.5f;

	private static final double K = DetectorConfig.defaults().limit().k();

	private final Baseline baseline = HealthModel
		.fit(IntStream.rangeClosed(1, 30).mapToObj((seed) -> clean(seed, Map.of())), DetectorConfig.defaults());

	@Test
	void aBaselineLearnsTheLevelAndSpreadAtEachSlot() {
		ChannelBand pressure = baseline.band(PRESSURE).orElseThrow();
		int slot = AlignedRuns.GRID.slot(50, Phase.SF6, 10);

		assertThat(pressure.mean(slot)).isCloseTo(0.040f, within(0.0002f));
		assertThat((double) pressure.sd(slot)).isCloseTo(PRESSURE_SD, within(PRESSURE_SD * 0.2));
		assertThat(pressure.hasBand(AlignedRuns.GRID.slot(50, Phase.SF6, 29))).isFalse();
		assertThat(baseline.band(HEATER).orElseThrow().role()).isEqualTo(ChannelRole.CONSTANT);
		assertThat(baseline.informativeChannels()).containsExactly(GAS1_FLOW, PLATEN_POWER, PRESSURE);
		assertThat(baseline.goodRuns()).hasSize(30);
	}

	@Test
	void aSlotNoGoodRunFilledHasNoBandEvenWhenItsNeighboursDo() {
		Set<Integer> empty = AlignedRuns.slots(50, Phase.SF6, 22, 22);
		Baseline gappy = HealthModel.fit(IntStream.rangeClosed(1, 10)
			.mapToObj((seed) -> AlignedRuns.run(RunKey.simulated(seed, 1, 1), signals(seed, Map.of()), empty::contains)),
				DetectorConfig.defaults());

		ChannelBand pressure = gappy.band(PRESSURE).orElseThrow();

		assertThat(pressure.hasBand(AlignedRuns.GRID.slot(50, Phase.SF6, 22))).isFalse();
		assertThat(pressure.hasBand(AlignedRuns.GRID.slot(51, Phase.SF6, 22))).isTrue();
	}

	@Test
	void aSlotWhereEveryGoodRunReadsTheSameValueIsFlooredAtTheChannelResolution() {
		ChannelBand gas1 = baseline.band(GAS1_FLOW).orElseThrow();

		assertThat(gas1.sd(AlignedRuns.GRID.slot(50, Phase.SF6, 10))).isEqualTo(GAS1_STEP);
	}

	@Test
	void cleanRunsFromTheSameProcessAreNotFlagged() {
		RunAssessment assessment = HealthModel.assess(clean(101, Map.of()), baseline);

		assertThat(assessment.limitFlags()).isZero();
		assertThat(assessment.firstChannel()).isEmpty();
	}

	@Test
	void aSustainedShiftIsConfirmedOnItsFifthSampleAndRanksFirst() {
		Map<ChannelName, AlignedRuns.Signal> shifted = Map.of(PRESSURE,
				(cycle, phase, offset) -> (float) (level(PRESSURE, phase, offset) + ((cycle >= 50) ? 0.005 : 0)));
		AlignedRun run = clean(102, shifted);

		RunAssessment assessment = HealthModel.assess(run, baseline);

		Excursion first = assessment.verdict(PRESSURE).firstExcursion().orElseThrow();
		assertThat(first.startSlot()).isEqualTo(AlignedRuns.GRID.slot(50, Phase.SF6, 0));
		assertThat(first.confirmSlot()).isEqualTo(AlignedRuns.GRID.slot(50, Phase.SF6, 4));
		assertThat(run.timeAt(first.confirmSlot()) - run.timeAt(first.startSlot())).isCloseTo(0.8, within(1e-4));
		assertThat(assessment.verdict(PRESSURE).persistentZ()).isGreaterThan(K);
		assertThat(assessment.firstChannel()).contains(PRESSURE);
		assertThat(assessment.verdict(PLATEN_POWER).excursions()).isEmpty();
	}

	@Test
	void theLimitRuleConfirmsExactlyWhenThePersistentZPassesK() {
		// every good run reads Gas1Flow 100 during SF6, so the band there is 100 +/- the 0.5 resolution
		ChannelVerdict atK = HealthModel.assess(clean(108, raisedGas1(6 * GAS1_STEP)), baseline).verdict(GAS1_FLOW);
		ChannelVerdict pastK = HealthModel.assess(clean(108, raisedGas1(7 * GAS1_STEP)), baseline).verdict(GAS1_FLOW);

		assertThat(atK.persistentZ()).isEqualTo(6.0);
		assertThat(atK.excursions()).isEmpty();
		assertThat(pastK.persistentZ()).isEqualTo(7.0);
		assertThat(pastK.excursions()).hasSize(1);
	}

	@Test
	void aSpikeShorterThanThePersistenceRuleIsNotAnExcursion() {
		RunAssessment assessment = HealthModel.assess(clean(103, raisedPressure(10, 12)), baseline);

		assertThat(assessment.verdict(PRESSURE).excursions()).isEmpty();
		assertThat(assessment.verdict(PRESSURE).persistentZ()).isLessThan(K);
	}

	@Test
	void aRecordingGapSplitsAStreakSoItNeverConfirms() {
		Map<ChannelName, AlignedRuns.Signal> raised = raisedPressure(10, 17);
		Set<Integer> gap = AlignedRuns.slots(50, Phase.SF6, 13, 14);
		RunKey key = RunKey.simulated(104, 1, 1);

		AlignedRun unbroken = AlignedRuns.run(key, signals(104, raised));
		AlignedRun broken = AlignedRuns.run(key, signals(104, raised), gap::contains);

		assertThat(HealthModel.assess(unbroken, baseline).verdict(PRESSURE).excursions()).hasSize(1);
		assertThat(HealthModel.assess(broken, baseline).verdict(PRESSURE).excursions()).isEmpty();
	}

	@Test
	void theEarliestDepartureRanksFirstEvenWithASmallerZ() {
		Map<ChannelName, AlignedRuns.Signal> faults = Map.of(PLATEN_POWER,
				(cycle, phase, offset) -> (float) (level(PLATEN_POWER, phase, offset) + ((cycle >= 40) ? 3.0 : 0)), PRESSURE,
				(cycle, phase, offset) -> (float) (level(PRESSURE, phase, offset) + ((cycle >= 60) ? 0.02 : 0)));

		RunAssessment assessment = HealthModel.assess(clean(105, faults), baseline);

		assertThat(assessment.verdicts()).extracting(ChannelVerdict::channel)
			.containsExactly(PLATEN_POWER, PRESSURE, GAS1_FLOW);
		assertThat(Math.abs(assessment.verdict(PRESSURE).firstExcursion().orElseThrow().peakZ()))
			.isGreaterThan(Math.abs(assessment.verdict(PLATEN_POWER).firstExcursion().orElseThrow().peakZ()));
	}

	@Test
	void aShiftedPhaseMeanIsARunLevelDeviation() {
		Map<ChannelName, AlignedRuns.Signal> offset = Map.of(PRESSURE,
				(cycle, phase, offsetInPhase) -> (float) (level(PRESSURE, phase, offsetInPhase) + 0.0008));

		RunAssessment assessment = HealthModel.assess(clean(106, offset), baseline);

		assertThat(assessment.verdict(PRESSURE).deviation()).isTrue();
		assertThat(assessment.firstChannel()).contains(PRESSURE);
	}

	@Test
	void aChannelTheRunDoesNotCarryIsLeftOutRatherThanFlagged() {
		Map<ChannelName, AlignedRuns.Signal> withoutPower = new HashMap<>(signals(107, Map.of()));
		withoutPower.remove(PLATEN_POWER);

		RunAssessment assessment = HealthModel.assess(AlignedRuns.run(RunKey.simulated(107, 1, 1), withoutPower), baseline);

		assertThat(assessment.verdicts()).extracting(ChannelVerdict::channel).containsExactlyInAnyOrder(GAS1_FLOW, PRESSURE);
		assertThat(assessment.flagged()).isFalse();
	}

	@Test
	void fittingNothingIsRefused() {
		assertThatIllegalArgumentException().isThrownBy(() -> HealthModel.fit(Stream.of(), DetectorConfig.defaults()));
	}

	private static AlignedRun clean(int seed, Map<ChannelName, AlignedRuns.Signal> overrides) {
		return AlignedRuns.run(RunKey.simulated(seed, 1, 1), signals(seed, overrides));
	}

	/** Pressure raised by 40 sd over a stretch of cycle 50's SF6 phase. */
	private static Map<ChannelName, AlignedRuns.Signal> raisedPressure(int fromOffset, int toOffset) {
		return Map.of(PRESSURE, (cycle, phase, offset) -> (float) (level(PRESSURE, phase, offset)
				+ ((cycle == 50 && phase == Phase.SF6 && offset >= fromOffset && offset <= toOffset) ? 0.02 : 0)));
	}

	/** Gas1Flow raised over five samples of cycle 50's SF6 phase. */
	private static Map<ChannelName, AlignedRuns.Signal> raisedGas1(float by) {
		return Map.of(GAS1_FLOW,
				(cycle, phase, offset) -> 100f + ((cycle == 50 && offset >= 5 && offset <= 9) ? by : 0f));
	}

	/**
	 * Seeded noise around each channel's phase levels, a Gas1Flow that reads 100 during SF6 and moves in
	 * 0.5 steps during C4F8, and a constant heater. An override replaces a channel's level, or Gas1Flow's
	 * SF6 reading.
	 */
	private static Map<ChannelName, AlignedRuns.Signal> signals(int seed, Map<ChannelName, AlignedRuns.Signal> overrides) {
		SplittableRandom random = new SplittableRandom(seed);
		AlignedRuns.Signal pressure = overrides.getOrDefault(PRESSURE, (cycle, phase, offset) -> level(PRESSURE, phase, offset));
		AlignedRuns.Signal power = overrides.getOrDefault(PLATEN_POWER,
				(cycle, phase, offset) -> level(PLATEN_POWER, phase, offset));
		AlignedRuns.Signal gas1Sf6 = overrides.getOrDefault(GAS1_FLOW, (cycle, phase, offset) -> 100f);
		return Map.of(PRESSURE,
				(cycle, phase, offset) -> (float) (pressure.at(cycle, phase, offset) + PRESSURE_SD * random.nextGaussian()),
				PLATEN_POWER,
				(cycle, phase, offset) -> (float) (power.at(cycle, phase, offset) + POWER_SD * random.nextGaussian()),
				GAS1_FLOW,
				(cycle, phase, offset) -> (phase == Phase.SF6) ? gas1Sf6.at(cycle, phase, offset)
						: 100f + GAS1_STEP * random.nextInt(4),
				HEATER, (cycle, phase, offset) -> 1371f);
	}

	private static float level(ChannelName channel, Phase phase, int offset) {
		if (channel.equals(PRESSURE)) {
			return (phase == Phase.SF6) ? 0.040f : 0.050f;
		}
		if (phase == Phase.C4F8) {
			return 39f;
		}
		return (offset < 5) ? 79f : 29f;
	}

}
