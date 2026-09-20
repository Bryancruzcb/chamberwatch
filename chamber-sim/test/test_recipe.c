#include "test.h"

#include "recipe.h"

static recipe_t run_to_end(uint64_t seed, int lot, int wafer, int *ticks)
{
	recipe_t recipe;
	recipe_begin(&recipe, recipe_draw(seed, lot, wafer));
	int step = 0;
	while (recipe.state != STATE_END && step < 20000) {
		recipe_step(&recipe);
		step++;
	}
	*ticks = step;
	return recipe;
}

void test_recipe(void)
{
	/* the drawn lengths stay inside the windows the public wafers show */
	for (int wafer = 1; wafer <= 25; wafer++) {
		recipe_plan_t plan = recipe_draw(7, 1, wafer);
		CHECK(plan.sf6_ticks >= 21 && plan.sf6_ticks <= 24);
		CHECK(plan.c4f8_ticks >= 6 && plan.c4f8_ticks <= 9);
		CHECK(plan.lead_ticks == 0 || plan.lead_ticks == 14 || plan.lead_ticks == 21);
	}

	/* the same seed draws the same run, a different wafer a different one */
	recipe_plan_t once = recipe_draw(7, 1, 3);
	recipe_plan_t twice = recipe_draw(7, 1, 3);
	CHECK(once.sf6_ticks == twice.sf6_ticks && once.c4f8_ticks == twice.c4f8_ticks
			&& once.lead_ticks == twice.lead_ticks);

	/* a run walks idle, stabilize, strike, settle, then the etch */
	recipe_t recipe;
	recipe_begin(&recipe, recipe_draw(7, 1, 1));
	CHECK(recipe.state == STATE_IDLE);
	while (recipe.state == STATE_IDLE) {
		recipe_step(&recipe);
	}
	CHECK(recipe.state == STATE_STABILIZE);
	while (recipe.state == STATE_STABILIZE) {
		recipe_step(&recipe);
	}
	CHECK(recipe.state == STATE_STRIKE);
	while (recipe.state == STATE_STRIKE) {
		recipe_step(&recipe);
	}
	CHECK(recipe.state == STATE_SETTLE);
	while (recipe.state == STATE_SETTLE) {
		recipe_step(&recipe);
	}
	CHECK(recipe_etching(recipe.state));
	CHECK(recipe.cycle == 1);

	/* 100 cycles give 99 C4F8 phases, and the run ends after the long last SF6 phase and its gas tail */
	int ticks = 0;
	recipe_t finished = run_to_end(7, 1, 1, &ticks);
	CHECK(finished.state == STATE_END);
	CHECK(finished.c4f8_phases == 99);
	CHECK(finished.cycle == 100);
	/* about 11 minutes of model time, as the public wafers take */
	CHECK(ticks * RECIPE_TICK_S > 550.0 && ticks * RECIPE_TICK_S < 700.0);

	/* a finished run stays finished */
	recipe_state_t after = recipe_step(&finished);
	CHECK(after == STATE_END);
	CHECK(finished.tick * RECIPE_TICK_S < 700.0);

	/* every wafer of a lot reaches the end, whichever way its etch opens */
	for (int wafer = 1; wafer <= 10; wafer++) {
		int wafer_ticks = 0;
		recipe_t done = run_to_end(7, 2, wafer, &wafer_ticks);
		CHECK(done.state == STATE_END);
		CHECK(done.c4f8_phases == 99);
	}

	CHECK(recipe_plasma(STATE_STRIKE));
	CHECK(recipe_plasma(STATE_ETCH_SF6));
	CHECK(!recipe_plasma(STATE_SETTLE));
	CHECK(!recipe_etching(STATE_STRIKE));
}
