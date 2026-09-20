#include "rng.h"

static uint64_t mix(uint64_t z)
{
	z += 0x9E3779B97F4A7C15ULL;
	z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ULL;
	z = (z ^ (z >> 27)) * 0x94D049BB133111EBULL;
	return z ^ (z >> 31);
}

rng_t rng_stream(uint64_t seed, rng_purpose_t purpose, uint64_t index)
{
	rng_t rng;
	rng.state = mix(seed ^ mix((uint64_t)purpose * 0x100000001B3ULL + index));
	return rng;
}

uint64_t rng_next(rng_t *rng)
{
	rng->state += 0x9E3779B97F4A7C15ULL;
	uint64_t z = rng->state;
	z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ULL;
	z = (z ^ (z >> 27)) * 0x94D049BB133111EBULL;
	return z ^ (z >> 31);
}

double rng_uniform(rng_t *rng)
{
	/* the top 53 bits, the most a double holds exactly */
	return (double)(rng_next(rng) >> 11) * (1.0 / 9007199254740992.0);
}

double rng_range(rng_t *rng, double low, double high)
{
	return low + (high - low) * rng_uniform(rng);
}

double rng_normal(rng_t *rng)
{
	/* Twelve uniforms less six: mean 0, variance 1, and nothing but addition, so every platform agrees bit for
	 * bit. The tails stop at six sigma, which is further out than any noise this model needs. */
	double sum = 0.0;
	for (int draw = 0; draw < 12; draw++) {
		sum += rng_uniform(rng);
	}
	return sum - 6.0;
}
