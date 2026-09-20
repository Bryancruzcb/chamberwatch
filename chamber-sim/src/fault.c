#include "fault.h"

#include <string.h>

fault_kind_t fault_kind_of(const char *name)
{
	if (strcmp(name, "GAS_FLOW_STUCK_LOW") == 0) {
		return FAULT_GAS_FLOW_STUCK_LOW;
	}
	if (strcmp(name, "PRESSURE_SPIKE") == 0) {
		return FAULT_PRESSURE_SPIKE;
	}
	if (strcmp(name, "REFLECTED_POWER_RISE") == 0) {
		return FAULT_REFLECTED_POWER_RISE;
	}
	if (strcmp(name, "SENSOR_DROPOUT") == 0) {
		return FAULT_SENSOR_DROPOUT;
	}
	if (strcmp(name, "SENSOR_STUCK") == 0) {
		return FAULT_SENSOR_STUCK;
	}
	return FAULT_NONE;
}

const char *fault_kind_name(fault_kind_t kind)
{
	switch (kind) {
		case FAULT_GAS_FLOW_STUCK_LOW: return "GAS_FLOW_STUCK_LOW";
		case FAULT_PRESSURE_SPIKE: return "PRESSURE_SPIKE";
		case FAULT_REFLECTED_POWER_RISE: return "REFLECTED_POWER_RISE";
		case FAULT_SENSOR_DROPOUT: return "SENSOR_DROPOUT";
		case FAULT_SENSOR_STUCK: return "SENSOR_STUCK";
		case FAULT_NONE: return "NONE";
	}
	return "NONE";
}

int fault_active(const fault_t *fault, double time_s)
{
	if (fault->kind == FAULT_NONE || time_s < fault->start_s) {
		return 0;
	}
	if (fault->duration_s <= 0.0) {
		return 1;
	}
	return time_s < fault->start_s + fault->duration_s;
}
