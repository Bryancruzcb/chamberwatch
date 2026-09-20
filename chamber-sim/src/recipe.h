/* The recipe as a state machine, one tick of 0.2 s at a time.
 *
 * It walks the steps the public wafers show: idle, a stabilization step, a low-power strike, then 100 cycles that
 * alternate an SF6 phase with a C4F8 phase, and an end that runs the last SF6 phase long and leaves the gas on a
 * second after the plasma stops. The phase lengths are drawn once per run from the windows the dataset shows, so
 * a seed decides the whole structure before the first tick. */
#ifndef CHAMBER_RECIPE_H
#define CHAMBER_RECIPE_H

#include "rng.h"

#define RECIPE_CYCLES 100
#define RECIPE_TICK_S 0.2

typedef enum {
	STATE_IDLE = 0,
	STATE_STABILIZE,
	STATE_STRIKE,
	STATE_SETTLE,
	STATE_ETCH_SF6,
	STATE_ETCH_C4F8,
	STATE_GAS_TAIL,
	STATE_END,
	STATE_ABORTED
} recipe_state_t;

typedef struct {
	int sf6_ticks;   /* the steady SF6 phase, about 4.4 s */
	int c4f8_ticks;  /* the steady C4F8 phase, about 1.4 s */
	int lead_ticks;  /* the SF6 phase that opens the etch, 0 when it opens with C4F8 */
	int last_ticks;  /* the SF6 phase that closes it, which runs longer */
	int tail_ticks;  /* how long the gas outlasts the plasma at the end */
	int stabilize_ticks;
	int strike_ticks;
	int settle_ticks;
} recipe_plan_t;

typedef struct {
	recipe_plan_t plan;
	recipe_state_t state;
	int tick;          /* ticks since the run started */
	int state_tick;    /* ticks in the current state */
	int cycle;         /* 1 to RECIPE_CYCLES once the etch runs, 0 before it */
	int c4f8_phases;   /* how many C4F8 phases have finished */
} recipe_t;

/* Draws a run's structure from its seed, the same way for the same seed. */
recipe_plan_t recipe_draw(uint64_t seed, int lot, int wafer);

void recipe_begin(recipe_t *recipe, recipe_plan_t plan);

/* Advances one tick. Returns the state after it. */
recipe_state_t recipe_step(recipe_t *recipe);

/* Whether the plasma is struck in this state. */
int recipe_plasma(recipe_state_t state);

/* Whether the etch is running, which is where the detectors score. */
int recipe_etching(recipe_state_t state);

const char *recipe_state_name(recipe_state_t state);

#endif
