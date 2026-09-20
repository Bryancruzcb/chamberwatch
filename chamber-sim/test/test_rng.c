#include "test.h"

#include "rng.h"

void test_rng(void)
{
	/* a stream repeats exactly */
	rng_t first = rng_stream(7, RNG_NOISE, 3);
	rng_t again = rng_stream(7, RNG_NOISE, 3);
	for (int draw = 0; draw < 100; draw++) {
		CHECK(rng_next(&first) == rng_next(&again));
	}

	/* different seeds, purposes and indexes are different streams */
	rng_t a = rng_stream(7, RNG_NOISE, 3);
	rng_t b = rng_stream(8, RNG_NOISE, 3);
	rng_t c = rng_stream(7, RNG_WANDER, 3);
	rng_t d = rng_stream(7, RNG_NOISE, 4);
	uint64_t first_a = rng_next(&a);
	CHECK(first_a != rng_next(&b));
	CHECK(first_a != rng_next(&c));
	CHECK(first_a != rng_next(&d));

	/* uniforms stay inside [0, 1) and cover it */
	rng_t uniform = rng_stream(1, RNG_RUN, 1);
	double low = 1.0;
	double high = 0.0;
	double sum = 0.0;
	for (int draw = 0; draw < 20000; draw++) {
		double value = rng_uniform(&uniform);
		CHECK(value >= 0.0 && value < 1.0);
		low = (value < low) ? value : low;
		high = (value > high) ? value : high;
		sum += value;
	}
	CHECK(low < 0.001);
	CHECK(high > 0.999);
	CHECK_NEAR(sum / 20000.0, 0.5, 0.01);

	/* the normal has the mean and the spread it claims */
	rng_t normal = rng_stream(2, RNG_LOT, 1);
	double total = 0.0;
	double squares = 0.0;
	int draws = 100000;
	for (int draw = 0; draw < draws; draw++) {
		double value = rng_normal(&normal);
		total += value;
		squares += value * value;
	}
	double mean = total / draws;
	CHECK_NEAR(mean, 0.0, 0.02);
	CHECK_NEAR(squares / draws - mean * mean, 1.0, 0.02);

	/* a range covers what it says and nothing else */
	rng_t ranged = rng_stream(3, RNG_FAULT, 1);
	for (int draw = 0; draw < 1000; draw++) {
		double value = rng_range(&ranged, 4.0, 7.0);
		CHECK(value >= 4.0 && value < 7.0);
	}
}
