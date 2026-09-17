package io.github.bryancruzcb.chamberwatch.eval;

import java.util.Map;
import java.util.SortedMap;
import java.util.SplittableRandom;
import java.util.TreeMap;
import java.util.stream.IntStream;

import io.github.bryancruzcb.chamberwatch.sim.FaultKind;
import io.github.bryancruzcb.chamberwatch.sim.FaultPlan;
import io.github.bryancruzcb.chamberwatch.sim.FaultPlans;

/** Which test runs get which faults, drawn from the seed alone, in the sizes {@link FaultPlans} gives. */
final class FaultSchedule {

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
			plans.put(chosen, FaultPlans.draw(kinds[i % kinds.length], random, config.firstFaultCycle(),
					config.lastFaultCycle()));
		}
		return plans;
	}

	/** For tests: how many plans of each kind a schedule holds. */
	static Map<FaultKind, Long> countByKind(Map<Integer, FaultPlan> plans) {
		Map<FaultKind, Long> counts = new TreeMap<>();
		plans.values().forEach((plan) -> counts.merge(plan.kind(), 1L, Long::sum));
		return counts;
	}

}
