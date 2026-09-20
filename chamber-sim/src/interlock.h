/* Interlocks: the conditions a real tool refuses to start a step without.
 *
 * An interlock refuses a transition rather than fudging the chamber into a state it could not reach, so a run
 * that should not have started does not quietly produce readings that look fine. */
#ifndef CHAMBER_INTERLOCK_H
#define CHAMBER_INTERLOCK_H

#include "chamber.h"
#include "recipe.h"

typedef enum {
	IL_OK = 0,
	IL_CHAMBER_NOT_PUMPED,   /* the chamber is above its base pressure, so the pump has not caught up */
	IL_NO_HELIUM_BACKSIDE,   /* the wafer is not clamped: the plasma would overheat it */
	IL_NO_PROCESS_GAS,       /* the plasma would strike without gas to strike in */
	IL_HEATER_COLD,          /* the walls are below their setpoint, so the chemistry would not repeat */
	IL_MATCH_NOT_READY,      /* the match network has not reached its position */
	IL_PLASMA_ALREADY_ON,    /* a second strike while the plasma burns */
	IL_RUN_ALREADY_ENDED     /* a step after the recipe finished */
} interlock_t;

/* Whether the chamber may move from one state to another now. IL_OK means it may. */
interlock_t interlock_check(const chamber_t *chamber, recipe_state_t from, recipe_state_t to);

const char *interlock_name(interlock_t code);

/* A sentence a reader can act on, naming the reading and the limit. */
void interlock_detail(interlock_t code, const chamber_t *chamber, char *out, int size);

#endif
