/* The wire: one JSON object per line, in both directions.
 *
 * JSON Lines keeps the protocol readable in a terminal and parseable by anything, and the subset here is small
 * enough to write and read without a library: objects one level deep, whose values are strings, numbers, true,
 * false or null. Anything else is refused rather than half-understood. */
#ifndef CHAMBER_FRAME_H
#define CHAMBER_FRAME_H

#include <stdint.h>

#include "channels.h"
#include "fault.h"

#define FRAME_MAX 8192
#define COMMAND_MAX 4096

/* Each writer returns the characters written, or -1 when the frame would not fit. */

int frame_hello(char *out, int size, uint64_t seed, int lot, int wafer, const char *run_key);

int frame_sample(char *out, int size, int tick, double time_s, const char *state, int cycle,
		const double values[CHANNEL_COUNT]);

int frame_ack(char *out, int size, const char *cmd, int tick, int accepted, const char *refused,
		const char *detail);

int frame_end(char *out, int size, const char *reason, int samples, const fault_t *fault);

int frame_error(char *out, int size, const char *reason);

/* A command as it arrived. Unset numbers read as NaN and unset strings are empty. */
typedef struct {
	char cmd[48];
	int lot;
	int wafer;
	char kind[48];
	char channel[48];
	double start_s;
	double duration_s;
	double magnitude;
} command_t;

typedef enum {
	COMMAND_OK = 0,
	COMMAND_BAD_JSON,
	COMMAND_NO_CMD,
	COMMAND_TOO_LONG
} command_status_t;

/* Parses one line. The line is not modified. */
command_status_t command_parse(const char *line, command_t *out);

#endif
