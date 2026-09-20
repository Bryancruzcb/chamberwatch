#include "interlock.h"

#include <stdio.h>

/* The limits, taken from what the public wafers hold while they etch. */
#define BASE_PRESSURE_LIMIT 0.01
#define HELIUM_CLAMP_LIMIT 12.0
#define GAS_LIMIT 50.0
#define HEATER_LIMIT 1300.0

interlock_t interlock_check(const chamber_t *chamber, recipe_state_t from, recipe_state_t to)
{
	if (from == STATE_END || from == STATE_ABORTED) {
		return IL_RUN_ALREADY_ENDED;
	}
	if (to == STATE_STABILIZE) {
		if (chamber->chamber_pressure > BASE_PRESSURE_LIMIT) {
			return IL_CHAMBER_NOT_PUMPED;
		}
		return IL_OK;
	}
	if (to == STATE_STRIKE) {
		if (chamber->sf6_flow + chamber->c4f8_flow < GAS_LIMIT) {
			return IL_NO_PROCESS_GAS;
		}
		if (chamber->helium_pressure < HELIUM_CLAMP_LIMIT) {
			return IL_NO_HELIUM_BACKSIDE;
		}
		if (chamber->source_power > 100.0) {
			return IL_PLASMA_ALREADY_ON;
		}
		return IL_OK;
	}
	if (to == STATE_ETCH_SF6 || to == STATE_ETCH_C4F8) {
		if (chamber->helium_pressure < HELIUM_CLAMP_LIMIT) {
			return IL_NO_HELIUM_BACKSIDE;
		}
		if (channels_table()[CH_HEATER1_TEMP].idle < HEATER_LIMIT) {
			return IL_HEATER_COLD;
		}
		if (from == STATE_SETTLE && chamber->platen_load_capacitor <= 0.0) {
			return IL_MATCH_NOT_READY;
		}
		return IL_OK;
	}
	return IL_OK;
}

const char *interlock_name(interlock_t code)
{
	switch (code) {
		case IL_OK: return "OK";
		case IL_CHAMBER_NOT_PUMPED: return "IL_CHAMBER_NOT_PUMPED";
		case IL_NO_HELIUM_BACKSIDE: return "IL_NO_HELIUM_BACKSIDE";
		case IL_NO_PROCESS_GAS: return "IL_NO_PROCESS_GAS";
		case IL_HEATER_COLD: return "IL_HEATER_COLD";
		case IL_MATCH_NOT_READY: return "IL_MATCH_NOT_READY";
		case IL_PLASMA_ALREADY_ON: return "IL_PLASMA_ALREADY_ON";
		case IL_RUN_ALREADY_ENDED: return "IL_RUN_ALREADY_ENDED";
	}
	return "UNKNOWN";
}

void interlock_detail(interlock_t code, const chamber_t *chamber, char *out, int size)
{
	switch (code) {
		case IL_CHAMBER_NOT_PUMPED:
			snprintf(out, (size_t)size, "Pressure %.4f above %.4f", chamber->chamber_pressure, BASE_PRESSURE_LIMIT);
			break;
		case IL_NO_HELIUM_BACKSIDE:
			snprintf(out, (size_t)size, "HeliumBPPressure %.2f below %.2f", chamber->helium_pressure,
					HELIUM_CLAMP_LIMIT);
			break;
		case IL_NO_PROCESS_GAS:
			snprintf(out, (size_t)size, "Gas flow %.1f below %.1f", chamber->sf6_flow + chamber->c4f8_flow,
					GAS_LIMIT);
			break;
		case IL_PLASMA_ALREADY_ON:
			snprintf(out, (size_t)size, "SourceRFLoadPower %.1f already above 100", chamber->source_power);
			break;
		case IL_MATCH_NOT_READY:
			snprintf(out, (size_t)size, "PlatenRFLoadCapacitor %.2f not in position",
					chamber->platen_load_capacitor);
			break;
		case IL_HEATER_COLD:
			snprintf(out, (size_t)size, "Heater1Temp below %.0f", (double)HEATER_LIMIT);
			break;
		case IL_RUN_ALREADY_ENDED:
			snprintf(out, (size_t)size, "the run has already ended");
			break;
		case IL_OK:
			snprintf(out, (size_t)size, "ok");
			break;
	}
}
