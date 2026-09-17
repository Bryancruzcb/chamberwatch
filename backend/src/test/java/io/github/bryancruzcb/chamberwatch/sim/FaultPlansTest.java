package io.github.bryancruzcb.chamberwatch.sim;

import java.util.SortedMap;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

class FaultPlansTest {

	@Test
	void aDemoLotGetsOneFaultOfEachKindAfterItsCleanWafers() {
		SortedMap<Integer, FaultPlan> plans = FaultPlans.forLot(7, 901, 10, 3);

		assertThat(plans).hasSize(FaultKind.values().length);
		assertThat(plans.keySet()).allSatisfy((position) -> assertThat(position).isBetween(4, 10));
		assertThat(plans.values().stream().map(FaultPlan::kind)).containsExactlyInAnyOrder(FaultKind.values());
		assertThat(plans.values()).allSatisfy((plan) -> assertThat(plan.startS())
			.isBetween(4 * FaultPlans.CYCLE_SECONDS, 90 * FaultPlans.CYCLE_SECONDS));
		assertThat(FaultPlans.forLot(7, 901, 10, 3)).isEqualTo(plans);
		assertThat(FaultPlans.forLot(8, 901, 10, 3)).isNotEqualTo(plans);
		assertThat(FaultPlans.forLot(7, 902, 10, 3)).isNotEqualTo(plans);
	}

	@Test
	void aLotWithoutRoomForFourFaultsIsRejected() {
		assertThatIllegalArgumentException().isThrownBy(() -> FaultPlans.forLot(7, 901, 6, 3));
		assertThat(FaultPlans.forLot(7, 901, 7, 3).keySet()).containsExactly(4, 5, 6, 7);
	}

}
