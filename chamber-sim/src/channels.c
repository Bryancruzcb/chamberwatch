#include "channels.h"

#include <math.h>

/* Every number here was measured on the public wafers, not invented: the idle levels come from the template the
 * Java simulator built from them, the SF6 and C4F8 levels are a public wafer's own phase means, and the noise is
 * the median step between consecutive samples inside the etch, which for Gaussian noise is about its standard
 * deviation, and the spread is the standard deviation of a phase's mean over the first three wafers of every
 * public lot, which is how far one wafer sits from the next. The heaters move slower than the 0.1 degree they are reported in, so their drift is set so that the
 * reported value holds as long as the public heaters' does: 89, 44, 44 and 34 samples on average for heaters 1
 * to 4 over the first three wafers of every public lot. Only the DC bias ever reads below zero on the public
 * tool, down to -24 V, so it is the one channel not clamped at zero. Seven channels never move: the tool reports
 * them as constants. */
static const channel_spec_t TABLE[CHANNEL_COUNT] = {
	{ "EpdIntensity", 0.123, 0.123, 0.123, 0.0, 0.0, 1, 0.0, 0.0 },
	{ "ForeLinePressure", 23.804, 148.326, 88.744, 0.916, 0.305176, 1, 0.0, 0.7211 },
	{ "Gas1Flow", 0.320, 0.222, 0.225, 0.01, 0.01, 1, 0.0, 0.0593 },
	{ "Gas2Flow", 4.210, 4.170, 4.161, 0.02, 0.01, 1, 0.0, 0.1206 },
	{ "Gas3Flow", 0.0, 0.0, 0.0, 0.0, 0.0, 1, 0.0, 0.0 },
	{ "Gas4Flow", 5.085, 4.791, 272.548, 0.01, 0.01, 1, 0.0, 0.2177 },
	{ "Gas5Flow", 0.0, 580.615, 18.584, 0.0, 0.0, 1, 0.0, 0.3293 },
	{ "Gas7Flow", 2.060, 2.003, 2.003, 0.01, 0.01, 1, 0.0, 0.072 },
	{ "Gas8Flow", 0.0, 0.0, 0.0, 0.0, 0.0, 1, 0.0, 0.0 },
	{ "Heater1Temp", 1371.0, 1371.013, 1371.014, 0.0, 0.1, 1, 0.00141, 0.0026 },
	{ "Heater2Temp", 54.700, 54.438, 54.437, 0.0, 0.1, 1, 0.00278, 0.3011 },
	{ "Heater3Temp", 10.100, 10.162, 10.163, 0.0, 0.1, 1, 0.00279, 0.0306 },
	{ "Heater4Temp", 59.700, 60.007, 60.009, 0.0, 0.1, 1, 0.00382, 0.326 },
	{ "HeliumBPFlow", 0.134, 1.719, 1.724, 0.00732, 0.0012207, 1, 0.0, 0.1238 },
	{ "HeliumBPPressure", 0.014, 14.987, 14.986, 0.00122, 0.000610352, 1, 0.0, 0.0003 },
	{ "PlatenDcBias", 0.0, 2.069, 2.940, 10.743, 0.0305176, 0, 0.0, 0.7144 },
	{ "PlatenRFLoadCapacitor", 49.812, 89.517, 87.727, 0.223, 0.0, 1, 0.0, 0.5816 },
	{ "PlatenRFLoadPower", 0.0, 44.086, 44.818, 0.412, 0.0457764, 1, 0.0, 0.052 },
	{ "PlatenRFPeakToPeak", 0.0, 523.045, 690.386, 61.937, 0.0, 1, 0.0, 3.4024 },
	{ "PlatenRFReflectedPower", 0.0, 2.601, 5.503, 1.602, 0.0457764, 1, 0.0, 0.3918 },
	{ "PlatenRFTuningCapacitor", 49.934, 27.137, 30.351, 0.0488, 0.00305176, 1, 0.0, 0.0825 },
	{ "Pressure", 0.0007, 0.042, 0.044, 0.0002, 9.99942e-05, 1, 0.0, 0.0001 },
	{ "SourceRF2LoadPower", 0.0, 0.0, 0.0, 0.0, 0.0, 1, 0.0, 0.0 },
	{ "SourceRF2PeakToPeak", 0.0, 0.271, 0.0, 0.0, 0.152592, 1, 0.0, 0.0627 },
	{ "SourceRF2ReflectedPower", 0.0, 0.0, 0.0, 0.0, 0.0, 1, 0.0, 0.0 },
	{ "SourceRF2TuningCapacitor", 2.0, 2.0, 2.0, 0.0, 0.0, 1, 0.0, 0.0 },
	{ "SourceRFLoadPower", 0.0, 2791.727, 2791.888, 5.371, 0.167725, 1, 0.0, 0.182 },
	{ "SourceRFPeakToPeak", 0.0, 3314.185, 3164.593, 10.605, 0.152588, 1, 0.0, 5.1612 },
	{ "SourceRFReflectedPower", 0.0, 53.784, 411.959, 4.059, 0.0305176, 1, 0.0, 3.154 },
	{ "SourceRFTuningCapacitor", 3.0, 3.0, 3.0, 0.0, 0.0, 1, 0.0, 0.0 },
	{ "moriInnerCurrent", 0.0, 9.998, 9.998, 0.0, 0.00201416, 1, 0.0, 0.001 }
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
