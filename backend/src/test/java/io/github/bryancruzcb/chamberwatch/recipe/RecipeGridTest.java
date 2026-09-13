package io.github.bryancruzcb.chamberwatch.recipe;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

class RecipeGridTest {

	private final RecipeGrid grid = RecipeGrid.STANDARD;

	@Test
	void everySlotMapsToOnePositionAndBack() {
		assertThat(grid.slotCount()).isEqualTo(4000);
		for (int slot = 0; slot < grid.slotCount(); slot++) {
			assertThat(grid.slot(grid.position(slot))).isEqualTo(slot);
			assertThat(grid.cycleOf(slot)).isEqualTo(grid.position(slot).cycle());
		}
	}

	@Test
	void c4f8SlotsFollowTheSf6SlotsOfTheSameCycle() {
		assertThat(grid.slot(1, Phase.SF6, 0)).isZero();
		assertThat(grid.slot(1, Phase.C4F8, 0)).isEqualTo(30);
		assertThat(grid.slot(2, Phase.SF6, 0)).isEqualTo(40);
		assertThat(grid.position(3999)).isEqualTo(new RecipePosition(100, Phase.C4F8, 9));
	}

	@Test
	void anOffsetAtCapacityOrACycleOutOfRangeHasNoSlot() {
		assertThatIllegalArgumentException().isThrownBy(() -> grid.slot(5, Phase.C4F8, 10));
		assertThatIllegalArgumentException().isThrownBy(() -> grid.slot(101, Phase.SF6, 0));
	}

	@Test
	void onlyTheFirstAndLastCyclesAreNotSteady() {
		assertThat(grid.isSteady(1)).isFalse();
		assertThat(grid.isSteady(2)).isTrue();
		assertThat(grid.isSteady(99)).isTrue();
		assertThat(grid.isSteady(100)).isFalse();
	}

}
