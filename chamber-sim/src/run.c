#include "run.h"

#include <math.h>
#include <stdio.h>
#include <string.h>

static int channel_index(const char *name)
{
	for (int channel = 0; channel < CHANNEL_COUNT; channel++) {
		if (strcmp(channel_name((channel_t)channel), name) == 0) {
			return channel;
		}
	}
	return -1;
}

void session_begin(session_t *session, uint64_t seed, int lot, int wafer)
{
	session->seed = seed;
	session->lot = lot;
	session->wafer = wafer;
	recipe_begin(&session->recipe, recipe_draw(seed, lot, wafer));
	chamber_begin(&session->chamber, seed, lot, wafer);
	session->fault.kind = FAULT_NONE;
	session->fault.channel = 0;
	session->fault.start_s = 0.0;
	session->fault.duration_s = 0.0;
	session->fault.magnitude = 0.0;
	session->samples = 0;
	snprintf(session->run_key, sizeof session->run_key, "LIVE-s%llu-L%d-W%02d", (unsigned long long)seed, lot,
			wafer);
	for (int channel = 0; channel < CHANNEL_COUNT; channel++) {
		session->values[channel] = 0.0;
	}
}

interlock_t session_start(session_t *session)
{
	interlock_t code = interlock_check(&session->chamber, session->recipe.state, STATE_STABILIZE);
	if (code != IL_OK) {
		return code;
	}
	/* the run begins idle, and the machine walks itself from there */
	return IL_OK;
}

int session_tick(session_t *session)
{
	if (session->recipe.state == STATE_END || session->recipe.state == STATE_ABORTED) {
		return 0;
	}
	recipe_state_t before = session->recipe.state;
	recipe_state_t state = recipe_step(&session->recipe);
	if (state != before) {
		interlock_t code = interlock_check(&session->chamber, before, state);
		if (code != IL_OK && (state == STATE_STRIKE || state == STATE_ETCH_SF6 || state == STATE_ETCH_C4F8)) {
			session->recipe.state = STATE_ABORTED;
			return 0;
		}
	}
	chamber_step(&session->chamber, state, &session->fault);
	chamber_read(&session->chamber, state, &session->fault, session->values);
	session->samples++;
	return session_running(session);
}

void session_abort(session_t *session)
{
	session->recipe.state = STATE_ABORTED;
}

int session_inject(session_t *session, const command_t *command, char *reason, int size)
{
	fault_kind_t kind = fault_kind_of(command->kind);
	if (kind == FAULT_NONE) {
		snprintf(reason, (size_t)size, "no such fault kind: %s", command->kind);
		return -1;
	}
	int channel = channel_index(command->channel);
	if (channel < 0) {
		snprintf(reason, (size_t)size, "no such channel: %s", command->channel);
		return -1;
	}
	if (session->fault.kind != FAULT_NONE) {
		snprintf(reason, (size_t)size, "this run already carries a %s", fault_kind_name(session->fault.kind));
		return -1;
	}
	double start = (command->start_s == command->start_s) ? command->start_s
			: session->chamber.time_s + 1.0;
	if (start < session->chamber.time_s) {
		snprintf(reason, (size_t)size, "start_s %.1f is already past", start);
		return -1;
	}
	session->fault.kind = kind;
	session->fault.channel = channel;
	session->fault.start_s = start;
	session->fault.duration_s = (command->duration_s == command->duration_s) ? command->duration_s : 0.0;
	session->fault.magnitude = (command->magnitude == command->magnitude) ? command->magnitude : 0.5;
	return 0;
}

void session_random_fault(session_t *session)
{
	rng_t rng = rng_stream(session->seed, RNG_FAULT, (uint64_t)session->lot * 1000u + (uint64_t)session->wafer);
	int kind = 1 + (int)rng_range(&rng, 0, 5);
	/* somewhere inside the etch, which starts about 25 s in and runs about 600 s */
	double start = rng_range(&rng, 60.0, 500.0);
	session->fault.kind = (fault_kind_t)kind;
	session->fault.start_s = start;
	switch (session->fault.kind) {
		case FAULT_GAS_FLOW_STUCK_LOW:
			session->fault.channel = CH_GAS5_FLOW;
			session->fault.duration_s = 0.0;
			session->fault.magnitude = rng_range(&rng, 0.30, 0.95);
			break;
		case FAULT_PRESSURE_SPIKE:
			session->fault.channel = CH_PRESSURE;
			session->fault.duration_s = rng_range(&rng, 1.0, 3.0);
			session->fault.magnitude = rng_range(&rng, 0.01, 0.10);
			break;
		case FAULT_REFLECTED_POWER_RISE:
			session->fault.channel = CH_SOURCE_RF_REFLECTED_POWER;
			session->fault.duration_s = rng_range(&rng, 10.0, 40.0);
			session->fault.magnitude = rng_range(&rng, 15.0, 40.0);
			break;
		case FAULT_SENSOR_DROPOUT:
			session->fault.channel = CH_HELIUM_BP_PRESSURE;
			session->fault.duration_s = rng_range(&rng, 2.0, 12.0);
			session->fault.magnitude = 0.0;
			break;
		default:
			session->fault.kind = FAULT_SENSOR_STUCK;
			session->fault.channel = CH_HELIUM_BP_PRESSURE;
			session->fault.duration_s = rng_range(&rng, 4.0, 12.0);
			session->fault.magnitude = 0.0;
			break;
	}
}

int session_running(const session_t *session)
{
	return session->recipe.state != STATE_END && session->recipe.state != STATE_ABORTED;
}
