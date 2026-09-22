/* The 31 channels every lot of the public dataset records, in the order the tool reports them.
 *
 * The levels are the ones the public wafers show, so a run this program streams looks to the aligner and the
 * detectors like a run the tool recorded: Gas5Flow carries the SF6 marker, Gas4Flow the C4F8 marker, and
 * SourceRFLoadPower says when the etch is on. */
#ifndef CHAMBER_CHANNELS_H
#define CHAMBER_CHANNELS_H

#define CHANNEL_COUNT 31

typedef enum {
	CH_EPD_INTENSITY = 0,
	CH_FORELINE_PRESSURE,
	CH_GAS1_FLOW,
	CH_GAS2_FLOW,
	CH_GAS3_FLOW,
	CH_GAS4_FLOW,
	CH_GAS5_FLOW,
	CH_GAS7_FLOW,
	CH_GAS8_FLOW,
	CH_HEATER1_TEMP,
	CH_HEATER2_TEMP,
	CH_HEATER3_TEMP,
	CH_HEATER4_TEMP,
	CH_HELIUM_BP_FLOW,
	CH_HELIUM_BP_PRESSURE,
	CH_PLATEN_DC_BIAS,
	CH_PLATEN_RF_LOAD_CAPACITOR,
	CH_PLATEN_RF_LOAD_POWER,
	CH_PLATEN_RF_PEAK_TO_PEAK,
	CH_PLATEN_RF_REFLECTED_POWER,
	CH_PLATEN_RF_TUNING_CAPACITOR,
	CH_PRESSURE,
	CH_SOURCE_RF2_LOAD_POWER,
	CH_SOURCE_RF2_PEAK_TO_PEAK,
	CH_SOURCE_RF2_REFLECTED_POWER,
	CH_SOURCE_RF2_TUNING_CAPACITOR,
	CH_SOURCE_RF_LOAD_POWER,
	CH_SOURCE_RF_PEAK_TO_PEAK,
	CH_SOURCE_RF_REFLECTED_POWER,
	CH_SOURCE_RF_TUNING_CAPACITOR,
	CH_MORI_INNER_CURRENT
} channel_t;

typedef struct {
	const char *name;
	double idle;       /* what it reads with the chamber idle */
	double sf6;        /* its level in an SF6 phase of the etch */
	double c4f8;       /* its level in a C4F8 phase of the etch */
	double noise;      /* the size of its sample-to-sample noise */
	double resolution; /* the smallest step the tool reports, 0 when it reports a bare float */
	int non_negative;  /* 1 when the tool never reports below zero */
	double drift;      /* for a channel that moves slower than it is reported, the per-sample step of its slow
	                    * drift, 0 for the rest */
	double spread;     /* how far one wafer's phase mean sits from another's, as a standard deviation */
} channel_spec_t;

/* The table itself, CHANNEL_COUNT entries in channel_t order. */
const channel_spec_t *channels_table(void);

const char *channel_name(channel_t channel);

/* Rounds a value to the channel's resolution and clamps it at zero where the tool never reads below it. */
double channel_report(channel_t channel, double value);

#endif
