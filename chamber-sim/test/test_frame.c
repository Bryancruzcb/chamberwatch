#include "test.h"

#include <string.h>

#include "frame.h"

void test_frame(void)
{
	char out[FRAME_MAX];

	/* a hello names every channel the run will send */
	CHECK(frame_hello(out, sizeof out, 7, 1, 3, "LIVE-s7-L1-W03") > 0);
	CHECK(strstr(out, "\"type\":\"hello\"") != NULL);
	CHECK(strstr(out, "\"run\":\"LIVE-s7-L1-W03\"") != NULL);
	CHECK(strstr(out, "\"Gas5Flow\"") != NULL);
	CHECK(strstr(out, "\"moriInnerCurrent\"") != NULL);
	CHECK(out[strlen(out) - 1] == '\n');

	/* a sample carries one value per channel */
	double values[CHANNEL_COUNT];
	for (int channel = 0; channel < CHANNEL_COUNT; channel++) {
		values[channel] = channel;
	}
	CHECK(frame_sample(out, sizeof out, 12, 2.4, "ETCH_SF6", 1, values) > 0);
	CHECK(strstr(out, "\"tick\":12") != NULL);
	CHECK(strstr(out, "\"state\":\"ETCH_SF6\"") != NULL);
	int commas = 0;
	for (const char *at = strchr(out, '['); at != NULL && *at != ']'; at++) {
		commas += (*at == ',') ? 1 : 0;
	}
	CHECK(commas == CHANNEL_COUNT - 1);

	/* a frame that would not fit is refused rather than truncated */
	char small[32];
	CHECK(frame_sample(small, (int)sizeof small, 1, 0.2, "IDLE", 0, values) == -1);

	/* an end carries the fault that was injected, and null when it ran to the end */
	fault_t fault;
	fault.kind = FAULT_GAS_FLOW_STUCK_LOW;
	fault.channel = CH_GAS5_FLOW;
	fault.start_s = 187.894;
	fault.duration_s = 0.0;
	fault.magnitude = 0.3558;
	CHECK(frame_end(out, sizeof out, "COMPLETE", 2988, &fault) > 0);
	CHECK(strstr(out, "\"kind\":\"GAS_FLOW_STUCK_LOW\"") != NULL);
	CHECK(strstr(out, "\"channel\":\"Gas5Flow\"") != NULL);
	CHECK(strstr(out, "\"duration_s\":null") != NULL);
	CHECK(frame_end(out, sizeof out, "COMPLETE", 10, NULL) > 0);
	CHECK(strstr(out, "fault") == NULL);

	/* commands the program understands */
	command_t command;
	CHECK(command_parse("{\"cmd\":\"start\",\"lot\":2,\"wafer\":5}", &command) == COMMAND_OK);
	CHECK(strcmp(command.cmd, "start") == 0);
	CHECK(command.lot == 2 && command.wafer == 5);

	CHECK(command_parse(
			"{\"cmd\":\"inject\",\"kind\":\"SENSOR_STUCK\",\"channel\":\"HeliumBPPressure\",\"start_s\":312.4,"
			"\"duration_s\":null,\"magnitude\":0.36}",
			&command) == COMMAND_OK);
	CHECK(strcmp(command.kind, "SENSOR_STUCK") == 0);
	CHECK(strcmp(command.channel, "HeliumBPPressure") == 0);
	CHECK_NEAR(command.start_s, 312.4, 1e-9);
	CHECK(command.duration_s != command.duration_s); /* null stays unset */
	CHECK_NEAR(command.magnitude, 0.36, 1e-9);

	/* and the ones it refuses */
	CHECK(command_parse("{\"lot\":1}", &command) == COMMAND_NO_CMD);
	CHECK(command_parse("{}", &command) == COMMAND_NO_CMD);
	CHECK(command_parse("not json", &command) == COMMAND_BAD_JSON);
	CHECK(command_parse("{\"cmd\":\"abort\"", &command) == COMMAND_BAD_JSON);
	CHECK(command_parse("{\"cmd\":[1,2]}", &command) == COMMAND_BAD_JSON);

	char long_line[COMMAND_MAX + 16];
	memset(long_line, 'x', sizeof long_line - 1);
	long_line[sizeof long_line - 1] = '\0';
	CHECK(command_parse(long_line, &command) == COMMAND_TOO_LONG);

	/* an ack says what it refused and why */
	CHECK(frame_ack(out, sizeof out, "start", 0, 0, "IL_NO_HELIUM_BACKSIDE", "HeliumBPPressure 3.2 below 12") > 0);
	CHECK(strstr(out, "\"accepted\":false") != NULL);
	CHECK(strstr(out, "IL_NO_HELIUM_BACKSIDE") != NULL);
	CHECK(frame_ack(out, sizeof out, "abort", 5, 1, NULL, NULL) > 0);
	CHECK(strstr(out, "\"accepted\":true") != NULL);

	CHECK(frame_error(out, sizeof out, "BUSY") > 0);
	CHECK(strstr(out, "\"reason\":\"BUSY\"") != NULL);
}
