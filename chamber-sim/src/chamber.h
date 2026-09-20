/* The chamber itself: hidden state that the 31 channels are only views of.
 *
 * Nothing writes a reading directly. The recipe sets the flows it wants, the mass flow controllers take time to
 * reach them, the pump line follows the gas load, the match networks chase the plasma, and the wall condition
 * drifts down the lot. The readings come from that state, so an effect the chamber really has, such as a stuck
 * flow dragging the foreline pressure down, happens on its own instead of being written into the fault. */
#ifndef CHAMBER_CHAMBER_H
#define CHAMBER_CHAMBER_H

#include "channels.h"
#include "fault.h"
#include "recipe.h"
#include "rng.h"

typedef struct {
	/* what the recipe asks for */
	double sf6_setpoint;
	double c4f8_setpoint;
	double source_power_setpoint;
	/* what the chamber is actually doing */
	double sf6_flow;
	double c4f8_flow;
	double source_power;
	double chamber_pressure;
	double foreline_pressure;
	double platen_load_capacitor;
	double platen_tuning_capacitor;
	double wall_condition; /* 0 at a clean chamber, growing through a lot */
	double helium_pressure;
	/* the per-run and per-lot levels every channel is offset by */
	double run_offset[CHANNEL_COUNT];
	double wander[CHANNEL_COUNT];
	double last_reported[CHANNEL_COUNT];
	rng_t noise;
	rng_t wander_rng;
	double time_s;
	int tick;
} chamber_t;

/* Sets the chamber up for one wafer. The lot and the wafer decide the levels it starts from. */
void chamber_begin(chamber_t *chamber, uint64_t seed, int lot, int wafer);

/* Advances the chamber one tick under the recipe's current state and any fault acting now. */
void chamber_step(chamber_t *chamber, recipe_state_t state, const fault_t *fault);

/* Reads the 31 channels out of the chamber's state, applying a sensor fault on the way out. It draws this
 * tick's noise and remembers what it reported, which is what a stuck sensor repeats, so it takes the chamber as
 * it is rather than a copy of it. */
void chamber_read(chamber_t *chamber, recipe_state_t state, const fault_t *fault, double out[CHANNEL_COUNT]);

#endif
