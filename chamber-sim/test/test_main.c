#include "test.h"

int tests_failed = 0;
int checks_run = 0;

int main(void)
{
	test_rng();
	test_recipe();
	test_interlock();
	test_chamber();
	test_frame();
	printf("%d checks, %d failed\n", checks_run, tests_failed);
	return tests_failed == 0 ? 0 : 1;
}
