#include "recipe.h"

/* The windows the public wafers show, in ticks of 0.2 s: an SF6 phase of 4.2 to 4.8 s, a C4F8 phase of 1.2 to
 * 1.8 s, a stabilization step of 11.8 s, a strike of 1.4 s. */
#define SF6_MIN_TICKS 21
#define SF6_MAX_TICKS 24
#define C4F8_MIN_TICKS 6
#define C4F8_MAX_TICKS 9

recipe_plan_t recipe_draw(uint64_t seed, int lot, int wafer)
{
	rng_t rng = rng_stream(seed, RNG_TIMELINE, (uint64_t)lot * 1000u + (uint64_t)wafer);
	recipe_plan_t plan;
	plan.sf6_ticks = (int)rng_range(&rng, SF6_MIN_TICKS, SF6_MAX_TICKS + 1);
	plan.c4f8_ticks = (int)rng_range(&rng, C4F8_MIN_TICKS, C4F8_MAX_TICKS + 1);
	/* the etch opens with a short SF6 phase in most wafers, a full one in some, and with C4F8 in the rest */
	double opening = rng_uniform(&rng);
	if (opening < 0.68) {
		plan.lead_ticks = 14;
	}
	else if (opening < 0.78) {
		plan.lead_ticks = 21;
	}
	else {
		plan.lead_ticks = 0;
	}
	plan.last_ticks = 28;
	plan.tail_ticks = 5;
	plan.stabilize_ticks = 59;
	plan.strike_ticks = 7;
	plan.settle_ticks = 50;
	return plan;
}

void recipe_begin(recipe_t *recipe, recipe_plan_t plan)
{
	recipe->plan = plan;
	recipe->state = STATE_IDLE;
	recipe->tick = 0;
	recipe->state_tick = 0;
	recipe->cycle = 0;
	recipe->c4f8_phases = 0;
}

static void enter(recipe_t *recipe, recipe_state_t state)
{
	recipe->state = state;
	recipe->state_tick = 0;
}

recipe_state_t recipe_step(recipe_t *recipe)
{
	if (recipe->state == STATE_END || recipe->state == STATE_ABORTED) {
		return recipe->state;
	}
	recipe->tick++;
	recipe->state_tick++;
	const recipe_plan_t *plan = &recipe->plan;
	switch (recipe->state) {
		case STATE_IDLE:
			if (recipe->state_tick >= 30) {
				enter(recipe, STATE_STABILIZE);
			}
			break;
		case STATE_STABILIZE:
			if (recipe->state_tick >= plan->stabilize_ticks) {
				enter(recipe, STATE_STRIKE);
			}
			break;
		case STATE_STRIKE:
			if (recipe->state_tick >= plan->strike_ticks) {
				enter(recipe, STATE_SETTLE);
			}
			break;
		case STATE_SETTLE:
			if (recipe->state_tick >= plan->settle_ticks) {
				recipe->cycle = 1;
				enter(recipe, (plan->lead_ticks > 0) ? STATE_ETCH_SF6 : STATE_ETCH_C4F8);
			}
			break;
		case STATE_ETCH_SF6: {
			int length = (recipe->cycle == 1 && plan->lead_ticks > 0) ? plan->lead_ticks
					: (recipe->cycle > RECIPE_CYCLES - 1) ? plan->last_ticks : plan->sf6_ticks;
			if (recipe->state_tick >= length) {
				if (recipe->cycle > RECIPE_CYCLES - 1) {
					enter(recipe, STATE_GAS_TAIL);
				}
				else {
					enter(recipe, STATE_ETCH_C4F8);
				}
			}
			break;
		}
		case STATE_ETCH_C4F8:
			if (recipe->state_tick >= plan->c4f8_ticks) {
				recipe->c4f8_phases++;
				recipe->cycle++;
				enter(recipe, STATE_ETCH_SF6);
			}
			break;
		case STATE_GAS_TAIL:
			if (recipe->state_tick >= plan->tail_ticks) {
				enter(recipe, STATE_END);
			}
			break;
		default:
			break;
	}
	return recipe->state;
}

int recipe_plasma(recipe_state_t state)
{
	return state == STATE_STRIKE || state == STATE_ETCH_SF6 || state == STATE_ETCH_C4F8;
}

int recipe_etching(recipe_state_t state)
{
	return state == STATE_ETCH_SF6 || state == STATE_ETCH_C4F8;
}

const char *recipe_state_name(recipe_state_t state)
{
	switch (state) {
		case STATE_IDLE: return "IDLE";
		case STATE_STABILIZE: return "STABILIZE";
		case STATE_STRIKE: return "STRIKE";
		case STATE_SETTLE: return "SETTLE";
		case STATE_ETCH_SF6: return "ETCH_SF6";
		case STATE_ETCH_C4F8: return "ETCH_C4F8";
		case STATE_GAS_TAIL: return "GAS_TAIL";
		case STATE_END: return "END";
		case STATE_ABORTED: return "ABORTED";
	}
	return "UNKNOWN";
}
