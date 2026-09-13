package io.github.bryancruzcb.chamberwatch.store;

import java.util.List;

import io.github.bryancruzcb.chamberwatch.TestcontainersConfiguration;
import io.github.bryancruzcb.chamberwatch.recipe.Phase;
import io.github.bryancruzcb.chamberwatch.recipe.RecipeGrid;
import io.github.bryancruzcb.chamberwatch.recipe.RecipePosition;
import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@Import(TestcontainersConfiguration.class)
class RecipeSlotTableTest {

	@Autowired
	private JdbcClient jdbc;

	@Test
	void theRecipeSlotTableMatchesTheGrid() {
		RecipeGrid grid = RecipeGrid.STANDARD;

		List<RecipePosition> rows = jdbc.sql("select cycle, phase, phase_offset from recipe_slot order by slot")
			.query((rs, row) -> new RecipePosition(rs.getInt("cycle"), Phase.valueOf(rs.getString("phase")),
					rs.getInt("phase_offset")))
			.list();

		assertThat(rows).hasSize(grid.slotCount());
		for (int slot = 0; slot < grid.slotCount(); slot++) {
			assertThat(rows.get(slot)).isEqualTo(grid.position(slot));
		}
	}

}
