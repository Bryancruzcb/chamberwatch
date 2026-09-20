#include "frame.h"

#include <math.h>
#include <stdio.h>
#include <string.h>

/* Appends to a buffer, keeping track of how much room is left. Returns 0 when it no longer fits. */
typedef struct {
	char *out;
	int size;
	int at;
	int full;
} writer_t;

static void put(writer_t *writer, const char *text)
{
	int length = (int)strlen(text);
	if (writer->full || writer->at + length + 1 > writer->size) {
		writer->full = 1;
		return;
	}
	memcpy(writer->out + writer->at, text, (size_t)length);
	writer->at += length;
	writer->out[writer->at] = '\0';
}

static void put_number(writer_t *writer, double value, int decimals)
{
	char buffer[64];
	if (value != value || value > 1e300 || value < -1e300) {
		put(writer, "null");
		return;
	}
	snprintf(buffer, sizeof buffer, "%.*f", decimals, value);
	put(writer, buffer);
}

static void put_int(writer_t *writer, long value)
{
	char buffer[32];
	snprintf(buffer, sizeof buffer, "%ld", value);
	put(writer, buffer);
}

/* Only the characters a control protocol needs; a name with a quote in it is not one this program produces. */
static void put_string(writer_t *writer, const char *text)
{
	put(writer, "\"");
	put(writer, text);
	put(writer, "\"");
}

static int finish(writer_t *writer)
{
	put(writer, "\n");
	return writer->full ? -1 : writer->at;
}

int frame_hello(char *out, int size, uint64_t seed, int lot, int wafer, const char *run_key)
{
	writer_t writer = { out, size, 0, 0 };
	out[0] = '\0';
	put(&writer, "{\"type\":\"hello\",\"protocol\":1,\"seed\":");
	put_int(&writer, (long)seed);
	put(&writer, ",\"lot\":");
	put_int(&writer, lot);
	put(&writer, ",\"wafer\":");
	put_int(&writer, wafer);
	put(&writer, ",\"run\":");
	put_string(&writer, run_key);
	put(&writer, ",\"period_s\":0.2,\"channels\":[");
	for (int channel = 0; channel < CHANNEL_COUNT; channel++) {
		if (channel > 0) {
			put(&writer, ",");
		}
		put_string(&writer, channel_name((channel_t)channel));
	}
	put(&writer, "]}");
	return finish(&writer);
}

int frame_sample(char *out, int size, int tick, double time_s, const char *state, int cycle,
		const double values[CHANNEL_COUNT])
{
	writer_t writer = { out, size, 0, 0 };
	out[0] = '\0';
	put(&writer, "{\"type\":\"sample\",\"tick\":");
	put_int(&writer, tick);
	put(&writer, ",\"t\":");
	put_number(&writer, time_s, 3);
	put(&writer, ",\"state\":");
	put_string(&writer, state);
	put(&writer, ",\"cycle\":");
	put_int(&writer, cycle);
	put(&writer, ",\"v\":[");
	for (int channel = 0; channel < CHANNEL_COUNT; channel++) {
		if (channel > 0) {
			put(&writer, ",");
		}
		put_number(&writer, values[channel], 4);
	}
	put(&writer, "]}");
	return finish(&writer);
}

int frame_ack(char *out, int size, const char *cmd, int tick, int accepted, const char *refused,
		const char *detail)
{
	writer_t writer = { out, size, 0, 0 };
	out[0] = '\0';
	put(&writer, "{\"type\":\"ack\",\"cmd\":");
	put_string(&writer, cmd);
	put(&writer, ",\"tick\":");
	put_int(&writer, tick);
	put(&writer, ",\"accepted\":");
	put(&writer, accepted ? "true" : "false");
	if (!accepted && refused != NULL) {
		put(&writer, ",\"refused\":");
		put_string(&writer, refused);
		if (detail != NULL && detail[0] != '\0') {
			put(&writer, ",\"detail\":");
			put_string(&writer, detail);
		}
	}
	put(&writer, "}");
	return finish(&writer);
}

int frame_end(char *out, int size, const char *reason, int samples, const fault_t *fault)
{
	writer_t writer = { out, size, 0, 0 };
	out[0] = '\0';
	put(&writer, "{\"type\":\"end\",\"reason\":");
	put_string(&writer, reason);
	put(&writer, ",\"samples\":");
	put_int(&writer, samples);
	if (fault != NULL && fault->kind != FAULT_NONE) {
		put(&writer, ",\"fault\":{\"kind\":");
		put_string(&writer, fault_kind_name(fault->kind));
		put(&writer, ",\"channel\":");
		put_string(&writer, channel_name((channel_t)fault->channel));
		put(&writer, ",\"start_s\":");
		put_number(&writer, fault->start_s, 3);
		put(&writer, ",\"duration_s\":");
		if (fault->duration_s > 0.0) {
			put_number(&writer, fault->duration_s, 3);
		}
		else {
			put(&writer, "null");
		}
		put(&writer, ",\"magnitude\":");
		put_number(&writer, fault->magnitude, 4);
		put(&writer, "}");
	}
	put(&writer, "}");
	return finish(&writer);
}

int frame_error(char *out, int size, const char *reason)
{
	writer_t writer = { out, size, 0, 0 };
	out[0] = '\0';
	put(&writer, "{\"type\":\"error\",\"reason\":");
	put_string(&writer, reason);
	put(&writer, "}");
	return finish(&writer);
}

/* --- reading a command --------------------------------------------------------------------------------- */

static const char *skip_spaces(const char *at)
{
	while (*at == ' ' || *at == '\t' || *at == '\r' || *at == '\n') {
		at++;
	}
	return at;
}

/* Reads a quoted string into out. Returns the character after the closing quote, or NULL. */
static const char *read_string(const char *at, char *out, int size)
{
	if (*at != '"') {
		return NULL;
	}
	at++;
	int length = 0;
	while (*at != '"') {
		if (*at == '\0' || *at == '\\') {
			return NULL; /* escapes are not part of this subset */
		}
		if (length + 1 < size) {
			out[length++] = *at;
		}
		at++;
	}
	out[length] = '\0';
	return at + 1;
}

static const char *read_number(const char *at, double *out)
{
	char buffer[64];
	int length = 0;
	if (*at == '-' || *at == '+') {
		buffer[length++] = *at++;
	}
	while ((*at >= '0' && *at <= '9') || *at == '.' || *at == 'e' || *at == 'E' || *at == '-' || *at == '+') {
		if (length + 1 >= (int)sizeof buffer) {
			return NULL;
		}
		buffer[length++] = *at++;
	}
	if (length == 0) {
		return NULL;
	}
	buffer[length] = '\0';
	if (sscanf(buffer, "%lf", out) != 1) {
		return NULL;
	}
	return at;
}

command_status_t command_parse(const char *line, command_t *out)
{
	if (strlen(line) >= COMMAND_MAX) {
		return COMMAND_TOO_LONG;
	}
	memset(out, 0, sizeof *out);
	out->start_s = NAN;
	out->duration_s = NAN;
	out->magnitude = NAN;
	out->lot = -1;
	out->wafer = -1;
	const char *at = skip_spaces(line);
	if (*at != '{') {
		return COMMAND_BAD_JSON;
	}
	at = skip_spaces(at + 1);
	if (*at == '}') {
		return COMMAND_NO_CMD;
	}
	while (*at != '\0') {
		char key[48];
		at = read_string(at, key, sizeof key);
		if (at == NULL) {
			return COMMAND_BAD_JSON;
		}
		at = skip_spaces(at);
		if (*at != ':') {
			return COMMAND_BAD_JSON;
		}
		at = skip_spaces(at + 1);
		if (*at == '"') {
			char value[48];
			at = read_string(at, value, sizeof value);
			if (at == NULL) {
				return COMMAND_BAD_JSON;
			}
			if (strcmp(key, "cmd") == 0) {
				snprintf(out->cmd, sizeof out->cmd, "%s", value);
			}
			else if (strcmp(key, "kind") == 0) {
				snprintf(out->kind, sizeof out->kind, "%s", value);
			}
			else if (strcmp(key, "channel") == 0) {
				snprintf(out->channel, sizeof out->channel, "%s", value);
			}
		}
		else if (strncmp(at, "null", 4) == 0) {
			at += 4;
		}
		else if (strncmp(at, "true", 4) == 0) {
			at += 4;
		}
		else if (strncmp(at, "false", 5) == 0) {
			at += 5;
		}
		else {
			double value;
			at = read_number(at, &value);
			if (at == NULL) {
				return COMMAND_BAD_JSON;
			}
			if (strcmp(key, "lot") == 0) {
				out->lot = (int)value;
			}
			else if (strcmp(key, "wafer") == 0) {
				out->wafer = (int)value;
			}
			else if (strcmp(key, "start_s") == 0) {
				out->start_s = value;
			}
			else if (strcmp(key, "duration_s") == 0) {
				out->duration_s = value;
			}
			else if (strcmp(key, "magnitude") == 0) {
				out->magnitude = value;
			}
		}
		at = skip_spaces(at);
		if (*at == ',') {
			at = skip_spaces(at + 1);
			continue;
		}
		if (*at == '}') {
			break;
		}
		return COMMAND_BAD_JSON;
	}
	if (out->cmd[0] == '\0') {
		return COMMAND_NO_CMD;
	}
	return COMMAND_OK;
}
