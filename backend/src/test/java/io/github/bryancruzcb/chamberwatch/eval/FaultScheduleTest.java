package io.github.bryancruzcb.chamberwatch.eval;

import java.util.SortedMap;

import io.github.bryancruzcb.chamberwatch.sim.FaultKind;
import io.github.bryancruzcb.chamberwatch.sim.FaultPlan;
import io.github.bryancruzcb.chamberwatch.sim.FaultPlans;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class FaultScheduleTest {

	@Test
	void theDefaultScheduleFaults25DistinctRunsOfEachKindInsideTheCycleWindow() {
		EvaluationConfig config = EvaluationConfig.defaults();

		SortedMap<Integer, FaultPlan> plans = FaultSchedule.draw(config);

		assertThat(plans).hasSize(100);
		assertThat(FaultSchedule.countByKind(plans)).containsOnlyKeys(FaultKind.values())
			.allSatisfy((kind, count) -> assertThat(count).isEqualTo(25));
		assertThat(plans.keySet()).allSatisfy((index) -> assertThat(index).isBetween(0, config.testRuns() - 1));
		assertThat(plans.values()).allSatisfy((plan) -> assertThat(plan.startS())
			.isBetween((config.firstFaultCycle() - 1) * FaultPlans.CYCLE_SECONDS,
					config.lastFaultCycle() * FaultPlans.CYCLE_SECONDS));
		assertThat(FaultSchedule.draw(config)).isEqualTo(plans);
	}

}
