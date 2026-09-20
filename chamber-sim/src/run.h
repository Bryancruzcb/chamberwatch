/* One wafer's run: the recipe, the chamber it drives and the fault put into it, stepped together.
 *
 * Everything here is decided by the seed, the lot and the wafer, and by the commands that arrived, so a run can
 * be replayed exactly by replaying its commands. Nothing in this file touches a socket or the clock. */
#ifndef CHAMBER_RUN_H
#define CHAMBER_RUN_H

#include "chamber.h"
#include "fault.h"
#include "frame.h"
#include "interlock.h"
#include "recipe.h"

typedef struct {
	uint64_t seed;
	int lot;
	int wafer;
	recipe_t recipe;
	chamber_t chamber;
	fault_t fault;
	double values[CHANNEL_COUNT];
	int samples;
	char run_key[48];
} session_t;

/* Puts a wafer in the chamber, idle, ready to start. */
void session_begin(session_t *session, uint64_t seed, int lot, int wafer);

/* Starts the recipe. Returns IL_OK when it started, or the interlock that refused it. */
interlock_t session_start(session_t *session);

/* Advances one tick and fills session->values. Returns 1 while the run is going, 0 once it has ended. */
int session_tick(session_t *session);

/* Stops the run where it stands. */
void session_abort(session_t *session);

/* Puts a fault into the run. Returns 0 when it was accepted, or fills reason and returns -1. */
int session_inject(session_t *session, const command_t *command, char *reason, int size);

/* Draws a fault of the kinds and sizes the public wafers suggest, for --fault=random. */
void session_random_fault(session_t *session);

int session_running(const session_t *session);

#endif
