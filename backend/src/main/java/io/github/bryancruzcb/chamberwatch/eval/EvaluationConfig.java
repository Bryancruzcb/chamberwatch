package io.github.bryancruzcb.chamberwatch.eval;

import io.github.bryancruzcb.chamberwatch.detect.DetectorConfig;
import io.github.bryancruzcb.chamberwatch.sim.FaultKind;
import io.github.bryancruzcb.chamberwatch.sim.SimulatorSettings;

/**
 * Everything one evaluation depends on. {@link #defaults()} is the committed evaluation behind
 * results/metrics.json.
 *
 * @param seed            decides every simulated run and every fault
 * @param trainingLots    lots whose wafers 1 to 3 train the baseline
 * @param testLots        lots of test wafers
 * @param lotSize         wafers per test lot
 * @param faultsPerKind   faulted test runs per fault kind, on runs picked at random
 * @param firstFaultCycle earliest cycle a fault starts in
 * @param lastFaultCycle  latest cycle a fault starts in
 */
public record EvaluationConfig(long seed, int trainingLots, int testLots, int lotSize, int faultsPerKind,
		int firstFaultCycle, int lastFaultCycle, DetectorConfig detectors, SimulatorSettings simulator) {

	public EvaluationConfig {
		if (trainingLots < 1 || testLots < 1 || lotSize < 1 || lotSize > 99 || faultsPerKind < 0
				|| faultsPerKind * FaultKind.values().length > testLots * lotSize || firstFaultCycle < 2
				|| lastFaultCycle < firstFaultCycle || lastFaultCycle > 98 || detectors == null || simulator == null) {
			throw new IllegalArgumentException("invalid evaluation config");
		}
	}

	/** 30 training runs, then 1,000 test runs in lots of 10 with 25 faults of each kind starting in cycles 5 to 90. */
	public static EvaluationConfig defaults() {
		return new EvaluationConfig(20260913L, 10, 100, 10, 25, 5, 90, DetectorConfig.defaults(),
				SimulatorSettings.DEFAULT);
	}

	public int testRuns() {
		return testLots * lotSize;
	}

}
