/* Deterministic random numbers: the same seed gives the same run on any machine.
 *
 * SplitMix64, with streams so that one draw's count cannot shift another's. A stream is named by the seed, a
 * purpose and an index, mixed into a starting state, so adding a draw to the chamber model never moves the
 * numbers the recipe or the faults draw. Only the bits of the state decide a value, and the draws call no libm
 * function, so two platforms agree exactly. */
#ifndef CHAMBER_RNG_H
#define CHAMBER_RNG_H

#include <stdint.h>

typedef struct {
	uint64_t state;
} rng_t;

/* Streams that must not disturb each other. */
typedef enum {
	RNG_TIMELINE = 1,
	RNG_LOT = 2,
	RNG_RUN = 3,
	RNG_WANDER = 4,
	RNG_NOISE = 5,
	RNG_FAULT = 6,
	RNG_CONTROLLER = 7
} rng_purpose_t;

/* A stream of its own for (seed, purpose, index). */
rng_t rng_stream(uint64_t seed, rng_purpose_t purpose, uint64_t index);

uint64_t rng_next(rng_t *rng);

/* Uniform in [0, 1). */
double rng_uniform(rng_t *rng);

/* Uniform in [low, high). */
double rng_range(rng_t *rng, double low, double high);

/* Standard normal, as twelve uniforms less six, so it needs no libm. */
double rng_normal(rng_t *rng);

#endif
