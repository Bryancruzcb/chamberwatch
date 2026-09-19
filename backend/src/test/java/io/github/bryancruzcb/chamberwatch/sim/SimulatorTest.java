package io.github.bryancruzcb.chamberwatch.sim;

import java.util.EnumMap;
import java.util.Map;

import io.github.bryancruzcb.chamberwatch.detect.Baseline;
import io.github.bryancruzcb.chamberwatch.detect.DetectorConfig;
import io.github.bryancruzcb.chamberwatch.detect.Excursion;
import io.github.bryancruzcb.chamberwatch.detect.HealthModel;
import io.github.bryancruzcb.chamberwatch.detect.RunAssessment;
import io.github.bryancruzcb.chamberwatch.recipe.AlignedRun;
import io.github.bryancruzcb.chamberwatch.recipe.Aligner;
import io.github.bryancruzcb.chamberwatch.recipe.AlignmentReport;
import io.github.bryancruzcb.chamberwatch.recipe.AlignmentStatus;
import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;
import io.github.bryancruzcb.chamberwatch.recipe.RawRun;
import io.github.bryancruzcb.chamberwatch.recipe.RunKey;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

class SimulatorTest {

	private static final SimulationTemplate TEMPLATE = SimulationTemplate.bundled();

	@Test
	void theSameSeedLotAndWaferGiveTheSameRunBitForBit() {
		SimulatedRun first = Simulator.seeded(7, TEMPLATE).run(RunSpec.clean(3, 5));
		SimulatedRun again = Simulator.seeded(7, TEMPLATE).run(RunSpec.clean(3, 5));
		SimulatedRun otherSeed = Simulator.seeded(8, TEMPLATE).run(RunSpec.clean(3, 5));

		assertThat(times(again.raw())).isEqualTo(times(first.raw()));
		assertThat(values(again.raw())).isEqualTo(values(first.raw()));
		assertThat(values(otherSeed.raw())).isNotEqualTo(values(first.raw()));
	}

	@Test
	void cleanRunsAlignLikeThePublicWafers() {
		Simulator simulator = Simulator.seeded(11, TEMPLATE);
		Map<EtchStart, Integer> starts = new EnumMap<>(EtchStart.class);
		for (int lot = 1; lot <= 8; lot++) {
			for (int position = 1; position <= 10; position++) {
				SimulatedRun run = simulator.run(RunSpec.clean(lot, position));
				AlignmentReport report = Aligner.STANDARD.align(run.raw()).orElseThrow().report();

				assertThat(report.status()).as(run.key().value()).isEqualTo(AlignmentStatus.ALIGNED);
				assertThat(report.c4f8Phases()).isEqualTo(run.c4f8Phases());
				assertThat(report.lastCycle()).isEqualTo(run.c4f8Phases() + 1);
				assertThat(report.cycle1Sf6()).isEqualTo(run.start() != EtchStart.C4F8);
				assertThat(report.irregularCycles()).isEmpty();
				assertThat(report.steadyOverflowSamples()).isZero();
				assertThat(report.etchStartS() - run.etchStartS()).isBetween(0.0, 0.21);
				starts.merge(run.start(), 1, Integer::sum);
			}
		}
		assertThat(starts).containsKeys(EtchStart.values());
	}

	@Test
	void aStuckSf6FlowIsCaughtOnGas5FlowFirst() {
		Simulator simulator = Simulator.seeded(42, TEMPLATE);
		Baseline baseline = HealthModel.fit(
				simulator.cleanTrainingRuns(30).map((r) -> Aligner.STANDARD.align(r.raw()).orElseThrow()),
				DetectorConfig.defaults());
		SimulatedRun simulated = simulator
			.run(RunSpec.faulted(901, 2, FaultPlan.gasFlowStuckLow(ChannelName.GAS5_FLOW, 30.25, 0.45)));
		AlignedRun run = Aligner.STANDARD.align(simulated.raw()).orElseThrow();

		RunAssessment result = HealthModel.assess(run, baseline);

		// at 45 % of its flow the SF6 marker is gone, so the aligner walks those cycles and says so
		assertThat(run.report().status()).isEqualTo(AlignmentStatus.DEGRADED);
		assertThat(result.firstChannel()).contains(ChannelName.GAS5_FLOW);
		Excursion first = result.verdict(ChannelName.GAS5_FLOW).firstExcursion().orElseThrow();
		assertThat(run.timeAt(first.confirmSlot()) - simulated.fault().orElseThrow().startS()).isBetween(0.0, 6.0);
	}

	@Test
	void aFaultChangesOnlyItsChannelInsideItsWindow() {
		Simulator simulator = Simulator.seeded(5, TEMPLATE);
		SimulatedRun clean = simulator.run(RunSpec.clean(2, 4));
		SimulatedRun faulted = simulator.run(RunSpec.faulted(2, 4, FaultPlan.pressureSpike(200, 3.0, 0.1)));
		InjectedFault fault = faulted.fault().orElseThrow();
		int pressure = clean.raw().channels().indexOf(ChannelName.of("Pressure"));

		assertThat(times(faulted.raw())).isEqualTo(times(clean.raw()));
		assertThat(fault.startS()).isCloseTo(clean.etchStartS() + 200, within(1e-9));
		assertThat(fault.endS() - fault.startS()).isCloseTo(3.0, within(1e-9));
		for (int sample = 0; sample < clean.raw().sampleCount(); sample++) {
			double time = clean.raw().time(sample);
			boolean inside = time >= fault.startS() && time < fault.endS();
			for (int channel = 0; channel < clean.raw().channels().size(); channel++) {
				float before = clean.raw().value(channel, sample);
				float after = faulted.raw().value(channel, sample);
				if (channel == pressure && inside) {
					assertThat(after).isGreaterThan(before);
				}
				else {
					assertThat(after).isEqualTo(before);
				}
			}
		}
	}

	@Test
	void aStuckSensorRepeatsItsLastReadingInsideItsWindowAndNowhereElse() {
		Simulator simulator = Simulator.seeded(5, TEMPLATE);
		ChannelName channel = ChannelName.of("HeliumBPPressure");
		SimulatedRun clean = simulator.run(RunSpec.clean(2, 4));
		SimulatedRun faulted = simulator.run(RunSpec.faulted(2, 4, FaultPlan.sensorStuck(channel, 200, 4.0)));
		InjectedFault fault = faulted.fault().orElseThrow();
		int index = clean.raw().channels().indexOf(channel);

		float held = Float.NaN;
		int inside = 0;
		for (int sample = 0; sample < clean.raw().sampleCount(); sample++) {
			double time = clean.raw().time(sample);
			float before = clean.raw().value(index, sample);
			float after = faulted.raw().value(index, sample);
			if (time >= fault.startS() && time < fault.endS()) {
				if (inside == 0) {
					held = clean.raw().value(index, sample - 1);
				}
				assertThat(after).isEqualTo(held);
				inside++;
			}
			else {
				assertThat(after).isEqualTo(before);
			}
		}
		assertThat(inside).isEqualTo(20);
	}

	@Test
	void aStuckFlowTakesTheForelineDownWithItAndLeavesEveryOtherChannelAlone() {
		Simulator simulator = Simulator.seeded(5, TEMPLATE);
		SimulatedRun clean = simulator.run(RunSpec.clean(2, 4));
		SimulatedRun faulted = simulator
			.run(RunSpec.faulted(2, 4, FaultPlan.gasFlowStuckLow(ChannelName.GAS5_FLOW, 200, 0.5)));
		InjectedFault fault = faulted.fault().orElseThrow();
		int flow = clean.raw().channels().indexOf(ChannelName.GAS5_FLOW);
		int foreline = clean.raw().channels().indexOf(ChannelName.of("ForeLinePressure"));
		float resolution = 0.31f;

		int settled = 0;
		int untouched = 0;
		for (int sample = 2; sample < clean.raw().sampleCount(); sample++) {
			for (int channel = 0; channel < clean.raw().channels().size(); channel++) {
				if (channel != flow && channel != foreline) {
					assertThat(faulted.raw().value(channel, sample)).isEqualTo(clean.raw().value(channel, sample));
				}
			}
			float before = clean.raw().value(foreline, sample);
			float after = faulted.raw().value(foreline, sample);
			double missing = 0;
			boolean steady = true;
			for (int lag = 0; lag < 3; lag++) {
				double lost = clean.raw().value(flow, sample - lag) - faulted.raw().value(flow, sample - lag);
				missing += Simulator.FORELINE_RESPONSE[lag] * lost;
				steady &= Math.abs(lost - 300) < 5;
			}
			boolean inside = clean.raw().time(sample) >= fault.startS() && clean.raw().time(sample) < fault.endS();
			if (inside) {
				assertThat((double) after).isCloseTo(before - Simulator.FORELINE_PER_SCCM * missing, within(2.0 * resolution));
			}
			if (!inside || missing == 0) {
				assertThat(after).isEqualTo(before);
				untouched++;
			}
			else if (steady) {
				// half of 600 sccm missing for three samples: the foreline reads 63 lower
				assertThat((double) before - after).isCloseTo(63.0, within(1.5));
				settled++;
			}
		}
		assertThat(settled).isGreaterThan(500);
		assertThat(untouched).isGreaterThan(1000);
	}

	@Test
	void trainingRunsAreTheFirstThreeWafersOfEachLot() {
		assertThat(Simulator.seeded(3, TEMPLATE).cleanTrainingRuns(6).map(SimulatedRun::key).map(RunKey::value))
			.containsExactly("SIM-s3-L1-W01", "SIM-s3-L1-W02", "SIM-s3-L1-W03", "SIM-s3-L2-W01", "SIM-s3-L2-W02",
					"SIM-s3-L2-W03");
	}

	private static double[] times(RawRun raw) {
		double[] times = new double[raw.sampleCount()];
		for (int sample = 0; sample < times.length; sample++) {
			times[sample] = raw.time(sample);
		}
		return times;
	}

	private static float[] values(RawRun raw) {
		int channels = raw.channels().size();
		float[] values = new float[raw.sampleCount() * channels];
		for (int sample = 0; sample < raw.sampleCount(); sample++) {
			for (int channel = 0; channel < channels; channel++) {
				values[sample * channels + channel] = raw.value(channel, sample);
			}
		}
		return values;
	}

}
