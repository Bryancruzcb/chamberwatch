#include "channels.h"

#include <math.h>

/* Idle levels come from the template the Java simulator measured on the public wafers; the SF6 and C4F8 levels
 * are a public wafer's own phase means. Seven channels never move: the tool reports them as constants. */
static const channel_spec_t TABLE[CHANNEL_COUNT] = {
	{ "EpdIntensity", 0.123, 0.123, 0.123, 0.0, 0.0, 1 },
	{ "ForeLinePressure", 23.804, 148.326, 88.744, 1.6, 0.305176, 1 },
	{ "Gas1Flow", 0.320, 0.222, 0.225, 0.02, 0.01, 1 },
	{ "Gas2Flow", 4.210, 4.170, 4.161, 0.03, 0.01, 1 },
	{ "Gas3Flow", 0.0, 0.0, 0.0, 0.0, 0.0, 1 },
	{ "Gas4Flow", 5.085, 4.791, 272.548, 1.2, 0.01, 1 },
	{ "Gas5Flow", 0.0, 580.615, 18.584, 2.5, 0.0, 1 },
	{ "Gas7Flow", 2.060, 2.003, 2.003, 0.02, 0.01, 1 },
	{ "Gas8Flow", 0.0, 0.0, 0.0, 0.0, 0.0, 1 },
	{ "Heater1Temp", 1371.0, 1371.013, 1371.014, 0.05, 0.1, 1 },
	{ "Heater2Temp", 54.700, 54.438, 54.437, 0.05, 0.1, 1 },
	{ "Heater3Temp", 10.100, 10.162, 10.163, 0.05, 0.1, 1 },
	{ "Heater4Temp", 59.700, 60.007, 60.009, 0.05, 0.1, 1 },
	{ "HeliumBPFlow", 0.134, 1.719, 1.724, 0.03, 0.0012207, 1 },
	{ "HeliumBPPressure", 0.014, 14.987, 14.986, 0.05, 0.000610352, 1 },
	{ "PlatenDcBias", 0.0, 2.069, 2.940, 0.08, 0.0305176, 1 },
	{ "PlatenRFLoadCapacitor", 49.812, 89.517, 87.727, 0.12, 0.0, 1 },
	{ "PlatenRFLoadPower", 0.0, 44.086, 44.818, 0.6, 0.0457764, 1 },
	{ "PlatenRFPeakToPeak", 0.0, 523.045, 690.386, 6.0, 0.0, 1 },
	{ "PlatenRFReflectedPower", 0.0, 2.601, 5.503, 0.3, 0.0457764, 1 },
	{ "PlatenRFTuningCapacitor", 49.934, 27.137, 30.351, 0.10, 0.00305176, 1 },
	{ "Pressure", 0.0007, 0.042, 0.044, 0.0004, 9.99942e-05, 1 },
	{ "SourceRF2LoadPower", 0.0, 0.0, 0.0, 0.0, 0.0, 1 },
	{ "SourceRF2PeakToPeak", 0.0, 0.271, 0.0, 0.05, 0.152592, 1 },
	{ "SourceRF2ReflectedPower", 0.0, 0.0, 0.0, 0.0, 0.0, 1 },
	{ "SourceRF2TuningCapacitor", 2.0, 2.0, 2.0, 0.0, 0.0, 1 },
	{ "SourceRFLoadPower", 0.0, 2791.727, 2791.888, 3.0, 0.167725, 1 },
	{ "SourceRFPeakToPeak", 0.0, 3314.185, 3164.593, 12.0, 0.152588, 1 },
	{ "SourceRFReflectedPower", 0.0, 53.784, 411.959, 8.0, 0.0305176, 1 },
	{ "SourceRFTuningCapacitor", 3.0, 3.0, 3.0, 0.0, 0.0, 1 },
	{ "moriInnerCurrent", 0.0, 9.998, 9.998, 0.02, 0.00201416, 1 }
};

const channel_spec_t *channels_table(void)
{
	return TABLE;
}

const char *channel_name(channel_t channel)
{
	return TABLE[channel].name;
}

double channel_report(channel_t channel, double value)
{
	const channel_spec_t *spec = &TABLE[channel];
	if (spec->non_negative && value < 0.0) {
		value = 0.0;
	}
	if (spec->resolution > 0.0) {
		value = floor(value / spec->resolution + 0.5) * spec->resolution;
	}
	return value;
}
