package io.github.bryancruzcb.chamberwatch.eval;

import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalDouble;
import java.util.SortedMap;
import java.util.TreeMap;
import java.util.stream.DoubleStream;

import io.github.bryancruzcb.chamberwatch.detect.Baseline;
import io.github.bryancruzcb.chamberwatch.detect.ChannelVerdict;
import io.github.bryancruzcb.chamberwatch.detect.Excursion;
import io.github.bryancruzcb.chamberwatch.detect.HealthModel;
import io.github.bryancruzcb.chamberwatch.detect.Hold;
import io.github.bryancruzcb.chamberwatch.detect.RunAssessment;
import io.github.bryancruzcb.chamberwatch.recipe.AlignedRun;
import io.github.bryancruzcb.chamberwatch.recipe.Aligner;
import io.github.bryancruzcb.chamberwatch.recipe.AlignmentResult;
import io.github.bryancruzcb.chamberwatch.recipe.AlignmentStatus;
import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;
import io.github.bryancruzcb.chamberwatch.sim.FaultKind;
import io.github.bryancruzcb.chamberwatch.sim.FaultPlan;
import io.github.bryancruzcb.chamberwatch.sim.InjectedFault;
import io.github.bryancruzcb.chamberwatch.sim.RunSpec;
import io.github.bryancruzcb.chamberwatch.sim.SimulatedRun;
import io.github.bryancruzcb.chamberwatch.sim.SimulationTemplate;
import io.github.bryancruzcb.chamberwatch.sim.Simulator;

/**
 * Scores the detectors on simulated runs with known faults, in memory and without a database. It fits a
 * baseline on clean training runs, then simulates, aligns, scores and drops one test run at a time. Pure:
 * the same config and template give the same metrics on any machine.
 *
 * <p>A fault counts as detected when its channel has an excursion confirmed after the fault starts and
 * starting no later than a cycle after it ends; the latency is from the fault's start to that confirmation.
 * A stuck gas flow also moves the foreline pressure, so the evaluation counts how often that knock-on is
 * flagged too and how often the flow is still ranked above it.
 */
public final class Evaluation {

	/** Test lots are numbered from here, clear of the training lots. */
	static final int FIRST_TEST_LOT = 101;

	/** An excursion may start up to a cycle after its fault ended and still count. */
	static final double LATE_S = 6.0;

	/** An excursion may confirm up to a sample before the fault's start time, since slots are 0.2 s wide. */
	static final double EARLY_S = 0.2;

	private Evaluation() {
	}

	public static Metrics run(EvaluationConfig config, SimulationTemplate template) {
		Simulator simulator = Simulator.seeded(config.seed(), template, config.simulator());
		Baseline baseline = HealthModel.fit(simulator.cleanTrainingRuns(config.trainingLots() * 3)
			.map((run) -> Aligner.STANDARD.align(run.raw()).orElseThrow()), config.detectors());
		SortedMap<Integer, FaultPlan> schedule = FaultSchedule.draw(config);
		Tally tally = new Tally();
		for (int lot = 0; lot < config.testLots(); lot++) {
			for (int position = 1; position <= config.lotSize(); position++) {
				int lotNo = FIRST_TEST_LOT + lot;
				FaultPlan plan = schedule.get(lot * config.lotSize() + position - 1);
				RunSpec spec = (plan == null) ? RunSpec.clean(lotNo, position) : RunSpec.faulted(lotNo, position, plan);
				tally.add(simulator.run(spec), baseline);
			}
		}
		return tally.metrics(config);
	}

	/**
	 * Seconds from the fault's start to the earliest confirmation that caught it, if one did: of an excursion,
	 * or for a stuck sensor of an excursion or a hold, whichever alarmed first.
	 */
	static OptionalDouble latency(RunAssessment assessment, AlignedRun run, InjectedFault fault) {
		Optional<ChannelVerdict> verdict = assessment.verdicts()
			.stream()
			.filter((candidate) -> candidate.channel().equals(fault.channel()))
			.findFirst();
		if (verdict.isEmpty()) {
			return OptionalDouble.empty();
		}
		DoubleStream.Builder latencies = DoubleStream.builder();
		for (Excursion excursion : verdict.get().excursions()) {
			latency(run, fault, excursion.startSlot(), excursion.confirmSlot()).ifPresent(latencies::add);
		}
		if (fault.kind() == FaultKind.SENSOR_STUCK) {
			for (Hold hold : verdict.get().holds()) {
				latency(run, fault, hold.startSlot(), hold.confirmSlot()).ifPresent(latencies::add);
			}
		}
		return latencies.build().min();
	}

	private static OptionalDouble latency(AlignedRun run, InjectedFault fault, int startSlot, int confirmSlot) {
		double confirmedS = run.timeAt(confirmSlot);
		if (confirmedS >= fault.startS() - EARLY_S && run.timeAt(startSlot) <= fault.endS() + LATE_S) {
			return OptionalDouble.of(Math.max(0, confirmedS - fault.startS()));
		}
		return OptionalDouble.empty();
	}

	private static final class Tally {

		private int clean;

		private int cleanFlagged;

		private int cleanLimitFlagged;

		private int cleanDeviationFlagged;

		private int cleanStuckFlagged;

		private int cleanDegraded;

		private int cleanEarly;

		private int cleanEarlyFlagged;

		private int cleanLate;

		private int cleanLateFlagged;

		private int cleanLateLimitFlagged;

		private int cleanLateDeviationFlagged;

		private int faulted;

		private int faultedDegraded;

		private int alignmentFailures;

		private int knockOnFlagged;

		private int causeAboveKnockOn;

		private final Map<FaultKind, Integer> injected = counts();

		private final Map<FaultKind, Integer> detected = counts();

		private final Map<FaultKind, Integer> rankedFirst = counts();

		private final Map<FaultKind, Integer> signatures = counts();

		private final Map<FaultKind, Integer> truePositives = counts();

		private final Map<FaultKind, List<Double>> latencies = new EnumMap<>(FaultKind.class);

		Tally() {
			for (FaultKind kind : FaultKind.values()) {
				latencies.put(kind, new ArrayList<>());
			}
		}

		void add(SimulatedRun simulated, Baseline baseline) {
			Optional<InjectedFault> fault = simulated.fault();
			if (fault.isPresent()) {
				faulted++;
				increment(injected, fault.get().kind());
			}
			else {
				clean++;
			}
			AlignmentResult result = Aligner.STANDARD.align(simulated.raw());
			if (result instanceof AlignmentResult.Failed) {
				alignmentFailures++;
				return;
			}
			AlignedRun run = result.orElseThrow();
			RunAssessment assessment = HealthModel.assess(run, baseline);
			Optional<FaultKind> signature = FaultSignature.of(assessment, run);
			signature.ifPresent((kind) -> increment(signatures, kind));
			boolean degraded = run.report().status() != AlignmentStatus.ALIGNED;
			if (fault.isEmpty()) {
				boolean flagged = assessment.flagged();
				cleanFlagged += flagged ? 1 : 0;
				cleanLimitFlagged += (assessment.limitFlags() > 0) ? 1 : 0;
				cleanDeviationFlagged += (assessment.deviationFlags() > 0) ? 1 : 0;
				cleanStuckFlagged += (assessment.stuckFlags() > 0) ? 1 : 0;
				cleanDegraded += degraded ? 1 : 0;
				if (simulated.key().positionInLot() <= 3) {
					cleanEarly++;
					cleanEarlyFlagged += flagged ? 1 : 0;
				}
				else {
					cleanLate++;
					cleanLateFlagged += flagged ? 1 : 0;
					cleanLateLimitFlagged += (assessment.limitFlags() > 0) ? 1 : 0;
					cleanLateDeviationFlagged += (assessment.deviationFlags() > 0) ? 1 : 0;
				}
				return;
			}
			FaultKind kind = fault.get().kind();
			faultedDegraded += degraded ? 1 : 0;
			if (signature.equals(Optional.of(kind))) {
				increment(truePositives, kind);
			}
			if (kind == FaultKind.GAS_FLOW_STUCK_LOW) {
				addKnockOn(assessment, fault.get());
			}
			OptionalDouble latency = latency(assessment, run, fault.get());
			if (latency.isPresent()) {
				increment(detected, kind);
				latencies.get(kind).add(latency.getAsDouble());
				if (assessment.firstChannel().equals(Optional.of(fault.get().channel()))) {
					increment(rankedFirst, kind);
				}
			}
		}

		/** Whether the foreline left its band in a run with a stuck flow, and whether the flow still ranks above it. */
		private void addKnockOn(RunAssessment assessment, InjectedFault fault) {
			List<ChannelName> ranked = assessment.verdicts().stream().map(ChannelVerdict::channel).toList();
			boolean flagged = assessment.verdicts()
				.stream()
				.anyMatch((verdict) -> verdict.channel().equals(Simulator.FORELINE_PRESSURE)
						&& verdict.firstDeparture().isPresent());
			if (flagged) {
				knockOnFlagged++;
				causeAboveKnockOn += (ranked.indexOf(fault.channel()) < ranked.indexOf(Simulator.FORELINE_PRESSURE)) ? 1 : 0;
			}
		}

		Metrics metrics(EvaluationConfig config) {
			SortedMap<String, Double> values = new TreeMap<>();
			values.put("config.seed", (double) config.seed());
			values.put("config.trainingRuns", (double) config.trainingLots() * 3);
			values.put("config.testRuns", (double) config.testRuns());
			values.put("config.limitK", config.detectors().limit().k());
			values.put("config.limitN", (double) config.detectors().limit().n());
			values.put("config.runZ", config.detectors().runZ());
			values.put("config.lotDegreesOfFreedom", (double) config.simulator().lotDegreesOfFreedom());
			values.put("config.swingRateScale", config.simulator().swingRateScale());
			values.put("runs.clean", (double) clean);
			values.put("runs.faulted", (double) faulted);
			values.put("runs.alignmentFailures", (double) alignmentFailures);
			values.put("clean.flaggedRate", rate(cleanFlagged, clean));
			values.put("clean.limitFlaggedRate", rate(cleanLimitFlagged, clean));
			values.put("clean.deviationFlaggedRate", rate(cleanDeviationFlagged, clean));
			values.put("clean.stuckFlaggedRate", rate(cleanStuckFlagged, clean));
			values.put("clean.flaggedRateWafers1To3", rate(cleanEarlyFlagged, cleanEarly));
			values.put("clean.flaggedRateWafers4Up", rate(cleanLateFlagged, cleanLate));
			values.put("clean.limitFlaggedRateWafers4Up", rate(cleanLateLimitFlagged, cleanLate));
			values.put("clean.deviationFlaggedRateWafers4Up", rate(cleanLateDeviationFlagged, cleanLate));
			values.put("clean.degradedRate", rate(cleanDegraded, clean));
			values.put("faulted.degradedRate", rate(faultedDegraded, faulted));
			values.put("knockOn.forelineFlaggedRate", rate(knockOnFlagged, injected.get(FaultKind.GAS_FLOW_STUCK_LOW)));
			values.put("knockOn.flowRankedAboveRate", rate(causeAboveKnockOn, knockOnFlagged));
			for (FaultKind kind : FaultKind.values()) {
				String prefix = "fault." + kind.name() + ".";
				values.put(prefix + "recall", rate(detected.get(kind), injected.get(kind)));
				values.put(prefix + "precision", rate(truePositives.get(kind), signatures.get(kind)));
				values.put(prefix + "medianLatencyS", median(latencies.get(kind)));
				values.put(prefix + "firstChannelRate", rate(rankedFirst.get(kind), detected.get(kind)));
			}
			return new Metrics(values);
		}

		private static Map<FaultKind, Integer> counts() {
			Map<FaultKind, Integer> counts = new EnumMap<>(FaultKind.class);
			for (FaultKind kind : FaultKind.values()) {
				counts.put(kind, 0);
			}
			return counts;
		}

		private static void increment(Map<FaultKind, Integer> counts, FaultKind kind) {
			counts.merge(kind, 1, Integer::sum);
		}

		private static double rate(int count, int total) {
			return (total == 0) ? 0 : (double) count / total;
		}

		/** The median, or -1 when nothing was detected. */
		private static double median(List<Double> values) {
			if (values.isEmpty()) {
				return -1;
			}
			double[] sorted = values.stream().mapToDouble(Double::doubleValue).sorted().toArray();
			int middle = sorted.length / 2;
			return (sorted.length % 2 == 1) ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
		}

	}

}
