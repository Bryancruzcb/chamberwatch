/* A test harness small enough to read in a minute: two macros and a counter. */
#ifndef CHAMBER_TEST_H
#define CHAMBER_TEST_H

#include <math.h>
#include <stdio.h>

extern int tests_failed;
extern int checks_run;

#define CHECK(condition)                                                                    \
	do {                                                                                    \
		checks_run++;                                                                       \
		if (!(condition)) {                                                                 \
			tests_failed++;                                                                 \
			printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #condition);                     \
		}                                                                                   \
	} while (0)

#define CHECK_NEAR(actual, expected, tolerance)                                             \
	do {                                                                                    \
		checks_run++;                                                                       \
		double a_ = (actual);                                                               \
		double e_ = (expected);                                                             \
		if (!(fabs(a_ - e_) <= (tolerance))) {                                              \
			tests_failed++;                                                                 \
			printf("FAIL %s:%d  %s = %.6f, expected %.6f +- %.6f\n", __FILE__, __LINE__,    \
					#actual, a_, e_, (double)(tolerance));                                  \
		}                                                                                   \
	} while (0)

void test_rng(void);
void test_recipe(void);
void test_interlock(void);
void test_chamber(void);
void test_frame(void);

#endif
