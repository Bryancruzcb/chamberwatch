package io.github.bryancruzcb.chamberwatch.recipe;

import java.util.List;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

class AlignerTest {

	private final Aligner aligner = Aligner.STANDARD;

	private final RecipeGrid grid = RecipeGrid.STANDARD;

	@Test
	void anEtchThatStartsWithAShortSf6PhaseAlignsCleanly() {
		EtchRuns.Generated generated = EtchRuns.etch().build();

		AlignedRun run = aligner.align(generated.run()).orElseThrow();

		AlignmentReport report = run.report();
		assertThat(report.status()).isEqualTo(AlignmentStatus.ALIGNED);
		assertThat(report.c4f8Phases()).isEqualTo(99);
		assertThat(report.lastCycle()).isEqualTo(100);
		assertThat(report.onsetsDetected()).isEqualTo(198);
		assertThat(report.onsetsPredicted()).isZero();
		assertThat(report.cycle1Sf6()).isTrue();
		assertThat(report.etchStartS()).isCloseTo(generated.sf6Onsets()[1], within(1e-9));
		assertThat(report.steadyOverflowSamples()).isZero();
		assertThat(report.edgeOverflowSamples()).isZero();
		assertThat(report.irregularCycles()).isEmpty();
		for (int cycle = 2; cycle <= 99; cycle++) {
			assertThat(run.timeAt(grid.slot(cycle, Phase.SF6, 0))).isCloseTo(generated.sf6Onsets()[cycle], within(1e-4));
			assertThat(run.timeAt(grid.slot(cycle, Phase.C4F8, 0))).isCloseTo(generated.c4f8Onsets()[cycle],
					within(1e-4));
		}
		assertThat(run.hasSample(grid.slot(1, Phase.SF6, 14))).isTrue();
		assertThat(run.hasSample(grid.slot(1, Phase.SF6, 15))).isFalse();
		assertThat(run.value(run.channels().indexOf(ChannelName.GAS5_FLOW), grid.slot(50, Phase.SF6, 5))).isEqualTo(600f);
		assertThat(run.value(run.channels().indexOf(EtchRuns.PRESSURE), grid.slot(50, Phase.C4F8, 3))).isEqualTo(0.05f);
	}

	@Test
	void anEtchThatStartsWithC4f8LeavesCycle1Sf6Empty() {
		EtchRuns.Generated generated = EtchRuns.etch().start(EtchRuns.Start.C4F8).build();

		AlignedRun run = aligner.align(generated.run()).orElseThrow();

		assertThat(run.report().status()).isEqualTo(AlignmentStatus.ALIGNED);
		assertThat(run.report().cycle1Sf6()).isFalse();
		assertThat(run.report().etchStartS()).isCloseTo(generated.c4f8Onsets()[1], within(1e-9));
		for (int offset = 0; offset < grid.capacity(Phase.SF6); offset++) {
			assertThat(run.hasSample(grid.slot(1, Phase.SF6, offset))).isFalse();
		}
	}

	@Test
	void aFullLengthCycle1Sf6PhaseFitsItsSlots() {
		AlignedRun run = aligner.align(EtchRuns.etch().start(EtchRuns.Start.FULL_SF6).build().run()).orElseThrow();

		assertThat(run.report().status()).isEqualTo(AlignmentStatus.ALIGNED);
		assertThat(run.report().cycle1Sf6()).isTrue();
		assertThat(run.hasSample(grid.slot(1, Phase.SF6, 21))).isTrue();
		assertThat(run.report().edgeOverflowSamples()).isZero();
	}

	@Test
	void aLowPowerStrikeBeforeTheEtchIsNotMistakenForCycle1() {
		EtchRuns.Generated generated = EtchRuns.etch().strike().c4f8Phases(98).build();

		AlignedRun run = aligner.align(generated.run()).orElseThrow();

		AlignmentReport report = run.report();
		assertThat(report.status()).isEqualTo(AlignmentStatus.ALIGNED);
		assertThat(report.c4f8Phases()).isEqualTo(98);
		assertThat(report.lastCycle()).isEqualTo(99);
		assertThat(report.etchStartS()).isCloseTo(generated.sf6Onsets()[1], within(1e-9));
		assertThat(run.timeAt(grid.slot(50, Phase.SF6, 0))).isCloseTo(generated.sf6Onsets()[50], within(1e-4));
		assertThat(run.hasSample(grid.slot(99, Phase.C4F8, 0))).isFalse();
	}

	@Test
	void aDipInsideAnSf6PhaseDoesNotMoveItsOnset() {
		EtchRuns.Generated generated = EtchRuns.etch().dipInSf6(40).build();

		AlignedRun run = aligner.align(generated.run()).orElseThrow();

		assertThat(run.report().status()).isEqualTo(AlignmentStatus.ALIGNED);
		assertThat(run.timeAt(grid.slot(40, Phase.SF6, 0))).isCloseTo(generated.sf6Onsets()[40], within(1e-4));
		assertThat(run.value(run.channels().indexOf(ChannelName.GAS5_FLOW), grid.slot(40, Phase.SF6, 11))).isZero();
		assertThat(run.timeAt(grid.slot(41, Phase.SF6, 0))).isCloseTo(generated.sf6Onsets()[41], within(1e-4));
	}

	@Test
	void aStuckSf6FlowIsWalkedThroughAndDegradesTheRun() {
		EtchRuns.Generated generated = EtchRuns.etch().stuckSf6From(30).build();

		AlignedRun run = aligner.align(generated.run()).orElseThrow();

		AlignmentReport report = run.report();
		assertThat(report.status()).isEqualTo(AlignmentStatus.DEGRADED);
		// SF6 onsets 30 to 99; with no marker after C4F8 phase 99 the walk ends there
		assertThat(report.onsetsPredicted()).isEqualTo(70);
		assertThat(report.lastCycle()).isEqualTo(99);
		assertThat(report.note()).hasValueSatisfying((note) -> assertThat(note).contains("cycle 30"));
		assertThat(run.timeAt(grid.slot(60, Phase.SF6, 0))).isCloseTo(generated.sf6Onsets()[60], within(1e-4));
		assertThat(run.value(run.channels().indexOf(ChannelName.GAS5_FLOW), grid.slot(60, Phase.SF6, 5))).isEqualTo(250f);
	}

	@Test
	void anIrregularCycleIsReportedAndStaysAligned() {
		EtchRuns.Generated generated = EtchRuns.etch().irregular(74).build();

		AlignedRun run = aligner.align(generated.run()).orElseThrow();

		assertThat(run.report().status()).isEqualTo(AlignmentStatus.ALIGNED);
		assertThat(run.report().irregularCycles()).containsExactly(74);
		assertThat(run.timeAt(grid.slot(75, Phase.SF6, 0))).isCloseTo(generated.sf6Onsets()[75], within(1e-4));
	}

	@Test
	void aGapAfterTheEtchIsReportedAndChangesNothing() {
		double lastSf6Onset = EtchRuns.etch().build().sf6Onsets()[100];

		AlignedRun run = aligner.align(EtchRuns.etch().gap(lastSf6Onset + 20.0, 20.0).build().run()).orElseThrow();

		assertThat(run.report().status()).isEqualTo(AlignmentStatus.ALIGNED);
		assertThat(run.report().largestGap()).hasValueSatisfying((gap) -> {
			assertThat(gap.lengthS()).isBetween(19.9, 20.5);
			assertThat(gap.insideEtch()).isFalse();
		});
	}

	@Test
	void aGapInsideTheEtchDegradesTheRunAndTheWalkRelocksAfterIt() {
		double cycle50Onset = EtchRuns.etch().build().sf6Onsets()[50];
		EtchRuns.Generated generated = EtchRuns.etch().gap(cycle50Onset + 1.0, 30.0).build();

		AlignedRun run = aligner.align(generated.run()).orElseThrow();

		assertThat(run.report().status()).isEqualTo(AlignmentStatus.DEGRADED);
		assertThat(run.report().largestGap()).hasValueSatisfying((gap) -> assertThat(gap.insideEtch()).isTrue());
		assertThat(run.timeAt(grid.slot(60, Phase.SF6, 0))).isCloseTo(generated.sf6Onsets()[60], within(1e-4));
	}

	@Test
	void aRunWithoutTheSf6MarkerFails() {
		AlignmentResult result = aligner.align(EtchRuns.etch().withoutGas5().build().run());

		assertThat(result).isInstanceOfSatisfying(AlignmentResult.Failed.class,
				(failed) -> assertThat(failed.reason()).contains("Gas5Flow"));
	}

	@Test
	void phaseSummariesCoverOnlyTheSteadyCycles() {
		AlignedRun run = aligner.align(EtchRuns.etch().build().run()).orElseThrow();

		PhaseSummary sf6Pressure = run.summaries()
			.stream()
			.filter((summary) -> summary.channel().equals(EtchRuns.PRESSURE) && summary.phase() == Phase.SF6)
			.findFirst()
			.orElseThrow();

		assertThat(sf6Pressure.n()).isEqualTo(98 * 23);
		assertThat(sf6Pressure.mean()).isCloseTo((22 * 0.04 + 0.03) / 23, within(1e-6));
	}

	@Test
	void aShortEtchKeepsItsLastCycleOutOfTheScoredCycles() {
		AlignedRun run = aligner.align(EtchRuns.etch().c4f8Phases(98).build().run()).orElseThrow();

		PhaseSummary sf6Pressure = run.summaries()
			.stream()
			.filter((summary) -> summary.channel().equals(EtchRuns.PRESSURE) && summary.phase() == Phase.SF6)
			.findFirst()
			.orElseThrow();

		assertThat(run.isScored(98)).isTrue();
		assertThat(run.isScored(99)).isFalse();
		assertThat(sf6Pressure.n()).isEqualTo(97 * 23);
	}

	@Test
	void aChannelThatNeverMovesInAPhaseHasNoSpread() {
		AlignedRun aligned = aligner.align(EtchRuns.etch().build().run()).orElseThrow();
		int slots = aligned.grid().slotCount();
		float[] values = new float[aligned.channels().size() * slots];
		for (int channel = 0; channel < aligned.channels().size(); channel++) {
			System.arraycopy(aligned.copyProfile(channel), 0, values, channel * slots, slots);
		}
		int pressure = aligned.channels().indexOf(EtchRuns.PRESSURE);
		for (int slot = 0; slot < slots; slot++) {
			if (aligned.hasSample(slot)) {
				values[pressure * slots + slot] = 0.123f;
			}
		}
		AlignedRun run = AlignedRun.adopt(aligned.key(), aligned.grid(), aligned.channels(), values,
				aligned.copySlotTimes(), aligned.report());

		List<PhaseSummary> flat = run.summaries()
			.stream()
			.filter((summary) -> summary.channel().equals(EtchRuns.PRESSURE))
			.toList();

		assertThat(flat).hasSize(2).allSatisfy((summary) -> {
			assertThat(summary.sd()).isZero();
			assertThat(summary.mean()).isEqualTo(0.123f, within(1e-12));
		});
	}

}
