#include "test.h"

#include "interlock.h"
#include "run.h"

void test_interlock(void)
{
	session_t session;
	session_begin(&session, 7, 1, 1);
	chamber_t *chamber = &session.chamber;

	/* an idle chamber, pumped down, may begin */
	CHECK(interlock_check(chamber, STATE_IDLE, STATE_STABILIZE) == IL_OK);
	CHECK(session_start(&session) == IL_OK);

	/* a chamber still above its base pressure may not */
	chamber->chamber_pressure = 0.5;
	CHECK(interlock_check(chamber, STATE_IDLE, STATE_STABILIZE) == IL_CHAMBER_NOT_PUMPED);
	chamber->chamber_pressure = 0.0007;

	/* the plasma will not strike without gas */
	chamber->sf6_flow = 0.0;
	chamber->c4f8_flow = 0.0;
	chamber->helium_pressure = 15.0;
	CHECK(interlock_check(chamber, STATE_STABILIZE, STATE_STRIKE) == IL_NO_PROCESS_GAS);

	/* nor without the wafer clamped */
	chamber->sf6_flow = 600.0;
	chamber->helium_pressure = 3.2;
	CHECK(interlock_check(chamber, STATE_STABILIZE, STATE_STRIKE) == IL_NO_HELIUM_BACKSIDE);

	/* with both in place it strikes */
	chamber->helium_pressure = 15.0;
	chamber->source_power = 0.0;
	CHECK(interlock_check(chamber, STATE_STABILIZE, STATE_STRIKE) == IL_OK);

	/* it will not strike twice */
	chamber->source_power = 2791.0;
	CHECK(interlock_check(chamber, STATE_STABILIZE, STATE_STRIKE) == IL_PLASMA_ALREADY_ON);

	/* the etch needs the wafer clamped too */
	chamber->helium_pressure = 1.0;
	CHECK(interlock_check(chamber, STATE_SETTLE, STATE_ETCH_SF6) == IL_NO_HELIUM_BACKSIDE);
	chamber->helium_pressure = 15.0;
	CHECK(interlock_check(chamber, STATE_SETTLE, STATE_ETCH_SF6) == IL_OK);

	/* nothing starts after the run ended */
	CHECK(interlock_check(chamber, STATE_END, STATE_ETCH_SF6) == IL_RUN_ALREADY_ENDED);
	CHECK(interlock_check(chamber, STATE_ABORTED, STATE_STABILIZE) == IL_RUN_ALREADY_ENDED);

	/* every refusal says what it saw and what it wanted */
	char detail[160];
	interlock_detail(IL_NO_HELIUM_BACKSIDE, chamber, detail, (int)sizeof detail);
	CHECK(detail[0] != '\0');
	CHECK(interlock_name(IL_NO_HELIUM_BACKSIDE)[0] == 'I');
	CHECK(interlock_name(IL_OK)[0] == 'O');

	/* a run whose clamp fails before the etch is aborted rather than left to produce readings */
	session_t unclamped;
	session_begin(&unclamped, 7, 1, 1);
	int aborted = 0;
	while (session_tick(&unclamped)) {
		if (unclamped.recipe.state == STATE_SETTLE) {
			unclamped.chamber.helium_pressure = 0.0;
		}
		if (unclamped.recipe.state == STATE_ABORTED) {
			aborted = 1;
			break;
		}
	}
	CHECK(aborted || unclamped.recipe.state == STATE_ABORTED);
}
