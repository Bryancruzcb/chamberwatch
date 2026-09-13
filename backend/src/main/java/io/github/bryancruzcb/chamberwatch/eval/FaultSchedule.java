package io.github.bryancruzcb.chamberwatch.eval;

import java.util.Map;
import java.util.SortedMap;
import java.util.SplittableRandom;
import java.util.TreeMap;
import java.util.stream.IntStream;

import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;
import io.github.bryancruzcb.chamberwatch.sim.FaultKind;
import io.github.bryancruzcb.chamberwatch.sim.FaultPlan;

/**
 * Which test runs get which faults, drawn from the seed alone. Sizes span easy and hard cases, so recall says
 * something: a pressure jump of 1 to 10 %, a reflected power rise of 5 to 60 W, a gas stuck at 30 to 95 % of
 * its flow, a dropout of 1 to 20 s.
 */
final class FaultSchedule {

	/** A steady cycle is about 6 s, so cycle k starts about (k - 1) * 6 s into the etch. */
	static final double CYCLE_SECONDS = 6.0;

	private FaultSchedule() {
	}

	/** @return the fault for each faulted test run, keyed by the run's index in lot order */
	static SortedMap<Integer, FaultPlan> draw(EvaluationConfig config) {
		SplittableRandom random = new SplittableRandom(config.seed());
		int runs = config.testRuns();
		int[] order = IntStream.range(0, runs).toArray();
		FaultKind[] kinds = FaultKind.values();
		SortedMap<Integer, FaultPlan> plans = new TreeMap<>();
		for (int i = 0; i < config.faultsPerKind() * kinds.length; i++) {
			int pick = i + random.nextInt(runs - i);
			int chosen = order[pick];
			order[pick] = order[i];
			order[i] = chosen;
			plans.put(chosen, plan(kinds[i % kinds.length], random, config));
		}
		return plans;
	}

	private static FaultPlan plan(FaultKind kind, SplittableRandom random, EvaluationConfig config) {
		int cycle = config.firstFaultCycle() + random.nextInt(config.lastFaultCycle() - config.firstFaultCycle() + 1);
		double startS = (cycle - 1 + random.nextDouble()) * CYCLE_SECONDS;
		ChannelName channel = kind.channels().get(random.nextInt(kind.channels().size()));
		return switch (kind) {
			case GAS_FLOW_STUCK_LOW -> FaultPlan.gasFlowStuckLow(channel, startS, between(random, 0.30, 0.95));
			case PRESSURE_SPIKE -> FaultPlan.pressureSpike(startS, between(random, 1.0, 6.0), between(random, 0.01, 0.10));
			case REFLECTED_POWER_RISE -> FaultPlan.reflectedPowerRise(startS, between(random, 10, 60), between(random, 5, 60));
			case SENSOR_DROPOUT -> FaultPlan.sensorDropout(channel, startS, between(random, 1.0, 20.0));
		};
	}

	private static double between(SplittableRandom random, double low, double high) {
		return low + (high - low) * random.nextDouble();
	}

	/** For tests: how many plans of each kind a schedule holds. */
	static Map<FaultKind, Long> countByKind(Map<Integer, FaultPlan> plans) {
		Map<FaultKind, Long> counts = new TreeMap<>();
		plans.values().forEach((plan) -> counts.merge(plan.kind(), 1L, Long::sum));
		return counts;
	}

}
