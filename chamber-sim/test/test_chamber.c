#include "test.h"

#include <string.h>

#include "run.h"

/* Runs a wafer to the end, keeping what the checks below need. */
typedef struct {
	int samples;
	double sf6_gas5;      /* the SF6 marker's mean in SF6 phases */
	double c4f8_gas5;
	double c4f8_gas4;     /* the C4F8 marker's mean in C4F8 phases */
	double etch_power;    /* the source power's mean while etching */
	double idle_power;
	double foreline_sf6;
	int sf6_slots;
	int c4f8_slots;
	int etch_samples;
	int idle_samples;
	double last_values[CHANNEL_COUNT];
} summary_t;

static summary_t run_wafer(session_t *session, uint64_t seed, int lot, int wafer, const fault_t *fault)
{
	summary_t summary;
	memset(&summary, 0, sizeof summary);
	session_begin(session, seed, lot, wafer);
	if (fault != NULL) {
		session->fault = *fault;
	}
	while (session_tick(session)) {
		recipe_state_t state = session->recipe.state;
		if (state == STATE_ETCH_SF6) {
			summary.sf6_gas5 += session->values[CH_GAS5_FLOW];
			summary.foreline_sf6 += session->values[CH_FORELINE_PRESSURE];
			summary.sf6_slots++;
		}
		else if (state == STATE_ETCH_C4F8) {
			summary.c4f8_gas5 += session->values[CH_GAS5_FLOW];
			summary.c4f8_gas4 += session->values[CH_GAS4_FLOW];
			summary.c4f8_slots++;
		}
		if (recipe_etching(state)) {
			summary.etch_power += session->values[CH_SOURCE_RF_LOAD_POWER];
			summary.etch_samples++;
		}
		else if (state == STATE_IDLE) {
			summary.idle_power += session->values[CH_SOURCE_RF_LOAD_POWER];
			summary.idle_samples++;
		}
		summary.samples++;
	}
	memcpy(summary.last_values, session->values, sizeof summary.last_values);
	if (summary.sf6_slots > 0) {
		summary.sf6_gas5 /= summary.sf6_slots;
		summary.foreline_sf6 /= summary.sf6_slots;
	}
	if (summary.c4f8_slots > 0) {
		summary.c4f8_gas5 /= summary.c4f8_slots;
		summary.c4f8_gas4 /= summary.c4f8_slots;
	}
	if (summary.etch_samples > 0) {
		summary.etch_power /= summary.etch_samples;
	}
	if (summary.idle_samples > 0) {
		summary.idle_power /= summary.idle_samples;
	}
	return summary;
}

void test_chamber(void)
{
	session_t session;
	summary_t clean = run_wafer(&session, 7, 1, 1, NULL);

	/* the markers the aligner needs: SF6 flow above 300 in an SF6 phase, C4F8 flow above 150 in a C4F8 phase,
	 * and etch power above 1000 while either runs */
	CHECK(clean.sf6_gas5 > 300.0);
	CHECK(clean.c4f8_gas5 < 300.0);
	CHECK(clean.c4f8_gas4 > 150.0);
	CHECK(clean.etch_power > 1000.0);
	CHECK(clean.idle_power < 100.0);
	CHECK(clean.samples > 2700 && clean.samples < 3600);

	/* the same seed gives the same run, bit for bit */
	session_t twin;
	summary_t again = run_wafer(&twin, 7, 1, 1, NULL);
	CHECK(again.samples == clean.samples);
	for (int channel = 0; channel < CHANNEL_COUNT; channel++) {
		CHECK(again.last_values[channel] == clean.last_values[channel]);
	}

	/* a different wafer is a different run */
	session_t other;
	summary_t second = run_wafer(&other, 7, 1, 2, NULL);
	CHECK(second.last_values[CH_FORELINE_PRESSURE] != clean.last_values[CH_FORELINE_PRESSURE]);

	/* the channels the tool reports as constants never move */
	CHECK(clean.last_values[CH_EPD_INTENSITY] == 0.123);
	CHECK(clean.last_values[CH_GAS3_FLOW] == 0.0);

	/* every channel is read through a sensor, so two wafers never report the same number twice: a channel that
	 * repeated exactly would be given a band of no width, and the smallest departure would score in the millions */
	session_t third;
	summary_t wafer3 = run_wafer(&third, 7, 1, 3, NULL);
	CHECK(wafer3.sf6_gas5 != clean.sf6_gas5);
	CHECK(wafer3.c4f8_gas4 != clean.c4f8_gas4);
	CHECK(wafer3.last_values[CH_PRESSURE] != clean.last_values[CH_PRESSURE]);
	CHECK(wafer3.last_values[CH_PLATEN_RF_LOAD_CAPACITOR] != clean.last_values[CH_PLATEN_RF_LOAD_CAPACITOR]);
	/* and within one wafer the SF6 marker moves from cycle to cycle rather than repeating its setpoint */
	session_t moving;
	session_begin(&moving, 7, 1, 1);
	double first_reading = -1.0;
	int different = 0;
	while (session_tick(&moving)) {
		if (moving.recipe.state == STATE_ETCH_SF6) {
			double value = moving.values[CH_GAS5_FLOW];
			if (first_reading < 0.0) {
				first_reading = value;
			}
			else if (value != first_reading) {
				different++;
			}
		}
	}
	CHECK(different > 1000);

	/* a stuck mass flow controller drags the foreline pressure down with it, without being told to */
	fault_t stuck;
	stuck.kind = FAULT_GAS_FLOW_STUCK_LOW;
	stuck.channel = CH_GAS5_FLOW;
	stuck.start_s = 60.0;
	stuck.duration_s = 0.0;
	stuck.magnitude = 0.36;
	session_t faulted;
	summary_t low = run_wafer(&faulted, 7, 1, 1, &stuck);
	CHECK(low.sf6_gas5 < clean.sf6_gas5 * 0.6);
	CHECK(low.foreline_sf6 < clean.foreline_sf6 - 10.0);

	/* a sensor dropout reads zero while it lasts and recovers after */
	fault_t dropout;
	dropout.kind = FAULT_SENSOR_DROPOUT;
	dropout.channel = CH_HELIUM_BP_PRESSURE;
	dropout.start_s = 100.0;
	dropout.duration_s = 5.0;
	dropout.magnitude = 0.0;
	session_t dropped;
	session_begin(&dropped, 7, 1, 1);
	dropped.fault = dropout;
	double during = -1.0;
	double after = -1.0;
	while (session_tick(&dropped)) {
		if (dropped.chamber.time_s > 101.0 && dropped.chamber.time_s < 104.0) {
			during = dropped.values[CH_HELIUM_BP_PRESSURE];
		}
		if (dropped.chamber.time_s > 106.0 && after < 0.0) {
			after = dropped.values[CH_HELIUM_BP_PRESSURE];
		}
	}
	CHECK(during == 0.0);
	CHECK(after > 10.0);

	/* a stuck sensor repeats one reading for as long as it lasts */
	session_t frozen;
	session_begin(&frozen, 7, 1, 1);
	frozen.fault.kind = FAULT_SENSOR_STUCK;
	frozen.fault.channel = CH_HELIUM_BP_PRESSURE;
	frozen.fault.start_s = 200.0;
	frozen.fault.duration_s = 6.0;
	frozen.fault.magnitude = 0.0;
	double held = -1.0;
	int repeats = 0;
	while (session_tick(&frozen)) {
		double value = frozen.values[CH_HELIUM_BP_PRESSURE];
		if (frozen.chamber.time_s > 200.5 && frozen.chamber.time_s < 205.5) {
			if (held < 0.0) {
				held = value;
			}
			else if (value == held) {
				repeats++;
			}
		}
	}
	CHECK(repeats > 20);
}
