/* A fault put into a run on purpose, so a detector can be caught catching it.
 *
 * A fault attaches where the trouble really starts, not to the reading: a stuck mass flow controller delivers
 * less gas than it was told to, so the pump line follows it down by itself, exactly as the public wafers show.
 * That keeps the knock-on effects out of the fault code and in the chamber, where they belong. */
#ifndef CHAMBER_FAULT_H
#define CHAMBER_FAULT_H

typedef enum {
	FAULT_NONE = 0,
	FAULT_GAS_FLOW_STUCK_LOW,
	FAULT_PRESSURE_SPIKE,
	FAULT_REFLECTED_POWER_RISE,
	FAULT_SENSOR_DROPOUT,
	FAULT_SENSOR_STUCK
} fault_kind_t;

typedef struct {
	fault_kind_t kind;
	int channel;      /* the channel it shows on, a channel_t */
	double start_s;   /* seconds into the run, measured from the first sample */
	double duration_s; /* how long it lasts; 0 or less means to the end of the etch */
	double magnitude; /* a share for a stuck flow, a rise in watts for reflected power, a share for a spike */
} fault_t;

fault_kind_t fault_kind_of(const char *name);

const char *fault_kind_name(fault_kind_t kind);

/* Whether the fault is acting at this moment. */
int fault_active(const fault_t *fault, double time_s);

#endif
