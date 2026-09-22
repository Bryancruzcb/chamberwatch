#include "chamber.h"

#include <math.h>

/* How fast a match network reaches its position. */
#define MATCH_LAG 0.30

/* The foreline pressure the pump holds per sccm of gas it is given, measured on the public wafers. */
#define FORELINE_PER_SCCM 0.21

#define FORELINE_BASE 23.804

/* How much of a slowly drifting channel's position carries over from one sample to the next. */
#define DRIFT_PHI 0.999

/* How far the platen load capacitor walks over a lot as the walls condition. */
#define WALL_PER_TICK 0.0000085

/*
 * A lot sits somewhere and a wafer sits somewhere inside its lot, and between them they give a channel the spread
 * from wafer to wafer the public tool shows. The lot's share is the larger, as it is in the public data, where a
 * clean shifts a lot's levels more than its wafers differ from each other.
 */
#define LOT_SHARE 0.88
#define WAFER_SHARE 0.47

static double clamp(double value, double low, double high)
{
	return value < low ? low : (value > high ? high : value);
}

/* Advances a controller one sample toward its setpoint, drawing how much of a new step the first samples catch. */
static void controller_step(controller_t *controller, double *flow, double target, rng_t *rng)
{
	if (target != controller->target) {
		controller->from = *flow;
		controller->target = target;
		controller->since = 0;
		if (target > controller->from) {
			/* measured on the public SF6 and C4F8 controllers: 93% of the step, sd 5 to 6%, then 99.8% */
			controller->first = clamp(0.93 + 0.055 * rng_normal(rng), 0.6, 1.0);
			controller->second = clamp(0.998 + 0.004 * rng_normal(rng), controller->first, 1.0);
		}
		else {
			/* and when it stops: about 0.4% of the flow left for one sample, then nothing */
			controller->first = 1.0 - fabs(0.0038 + 0.0045 * rng_normal(rng));
			controller->second = 1.0;
		}
	}
	controller->since++;
	double covered = (controller->since == 1) ? controller->first : (controller->since == 2) ? controller->second : 1.0;
	*flow = controller->from + (controller->target - controller->from) * covered;
	if (controller->since >= 3 && controller->target > 0.0) {
		/* a held setpoint wanders by about 1 part in 75,000, as the public flows do */
		*flow = controller->target * (1.0 + 1.3e-5 * rng_normal(rng));
	}
}

static double toward(double value, double target, double lag)
{
	return value + (target - value) * lag;
}

void chamber_begin(chamber_t *chamber, uint64_t seed, int lot, int wafer)
{
	const channel_spec_t *table = channels_table();
	rng_t lot_rng = rng_stream(seed, RNG_LOT, (uint64_t)lot);
	rng_t run_rng = rng_stream(seed, RNG_RUN, (uint64_t)lot * 1000u + (uint64_t)wafer);
	chamber->noise = rng_stream(seed, RNG_NOISE, (uint64_t)lot * 1000u + (uint64_t)wafer);
	chamber->controller_rng = rng_stream(seed, RNG_CONTROLLER, (uint64_t)lot * 1000u + (uint64_t)wafer);
	controller_t idle = { 0.0, 0.0, 3, 1.0, 1.0 };
	chamber->sf6_controller = idle;
	chamber->c4f8_controller = idle;
	chamber->wander_rng = rng_stream(seed, RNG_WANDER, (uint64_t)lot * 1000u + (uint64_t)wafer);
	for (int channel = 0; channel < CHANNEL_COUNT; channel++) {
		double spread = table[channel].spread;
		double lot_level = rng_normal(&lot_rng) * spread * LOT_SHARE;
		double run_level = rng_normal(&run_rng) * spread * WAFER_SHARE;
		chamber->run_offset[channel] = lot_level + run_level;
		/* a slowly drifting channel starts wherever its drift would have left it, not at its centre */
		chamber->wander[channel] = (table[channel].drift > 0.0)
				? rng_normal(&chamber->wander_rng) * table[channel].drift / sqrt(1.0 - DRIFT_PHI * DRIFT_PHI)
				: 0.0;
		chamber->last_reported[channel] = 0.0;
	}
	chamber->sf6_setpoint = 0.0;
	chamber->c4f8_setpoint = 0.0;
	chamber->source_power_setpoint = 0.0;
	chamber->sf6_flow = 0.0;
	chamber->c4f8_flow = 0.0;
	chamber->source_power = 0.0;
	chamber->chamber_pressure = table[CH_PRESSURE].idle;
	chamber->foreline_pressure = FORELINE_BASE;
	chamber->platen_load_capacitor = table[CH_PLATEN_RF_LOAD_CAPACITOR].idle;
	chamber->platen_tuning_capacitor = table[CH_PLATEN_RF_TUNING_CAPACITOR].idle;
	chamber->helium_pressure = table[CH_HELIUM_BP_PRESSURE].idle;
	/* a wafer late in its lot starts against walls the lot before it conditioned */
	chamber->wall_condition = (wafer - 1) * 0.35;
	chamber->time_s = 0.0;
	chamber->tick = 0;
}

void chamber_step(chamber_t *chamber, recipe_state_t state, const fault_t *fault)
{
	const channel_spec_t *table = channels_table();
	chamber->tick++;
	chamber->time_s = chamber->tick * RECIPE_TICK_S;

	/* what the recipe asks the tool for in this state */
	switch (state) {
		case STATE_STABILIZE:
			chamber->sf6_setpoint = 0.0;
			chamber->c4f8_setpoint = 300.0;
			chamber->source_power_setpoint = 0.0;
			break;
		case STATE_STRIKE:
			chamber->sf6_setpoint = 600.0;
			chamber->c4f8_setpoint = 0.0;
			chamber->source_power_setpoint = 142.0;
			break;
		case STATE_ETCH_SF6:
			chamber->sf6_setpoint = 600.0;
			chamber->c4f8_setpoint = 0.0;
			chamber->source_power_setpoint = table[CH_SOURCE_RF_LOAD_POWER].sf6;
			break;
		case STATE_ETCH_C4F8:
			chamber->sf6_setpoint = 0.0;
			chamber->c4f8_setpoint = 300.0;
			chamber->source_power_setpoint = table[CH_SOURCE_RF_LOAD_POWER].c4f8;
			break;
		case STATE_GAS_TAIL:
			chamber->sf6_setpoint = 600.0;
			chamber->c4f8_setpoint = 0.0;
			chamber->source_power_setpoint = 0.0;
			break;
		default:
			chamber->sf6_setpoint = 0.0;
			chamber->c4f8_setpoint = 0.0;
			chamber->source_power_setpoint = 0.0;
			break;
	}

	/* the mass flow controllers, where a stuck one delivers a share of what it was told */
	double sf6_target = chamber->sf6_setpoint;
	double c4f8_target = chamber->c4f8_setpoint;
	if (fault_active(fault, chamber->time_s) && fault->kind == FAULT_GAS_FLOW_STUCK_LOW) {
		if (fault->channel == CH_GAS5_FLOW) {
			sf6_target *= fault->magnitude;
		}
		else if (fault->channel == CH_GAS4_FLOW) {
			c4f8_target *= fault->magnitude;
		}
	}
	controller_step(&chamber->sf6_controller, &chamber->sf6_flow, sf6_target, &chamber->controller_rng);
	controller_step(&chamber->c4f8_controller, &chamber->c4f8_flow, c4f8_target, &chamber->controller_rng);
	chamber->source_power = toward(chamber->source_power, chamber->source_power_setpoint, 0.75);

	/* the throttle valve holds the chamber at its setpoint; the foreline follows the gas load */
	double gas_load = chamber->sf6_flow + chamber->c4f8_flow;
	double pressure_setpoint = recipe_etching(state)
			? (state == STATE_ETCH_SF6 ? table[CH_PRESSURE].sf6 : table[CH_PRESSURE].c4f8)
			: table[CH_PRESSURE].idle;
	chamber->chamber_pressure = toward(chamber->chamber_pressure, pressure_setpoint, 0.5);
	if (fault_active(fault, chamber->time_s) && fault->kind == FAULT_PRESSURE_SPIKE) {
		chamber->chamber_pressure *= 1.0 + fault->magnitude;
	}
	chamber->foreline_pressure = toward(chamber->foreline_pressure,
			FORELINE_BASE + FORELINE_PER_SCCM * gas_load, 0.45);

	/* the walls condition while the plasma burns, and the match network follows them */
	if (recipe_plasma(state)) {
		chamber->wall_condition += WALL_PER_TICK * 1000.0 * RECIPE_TICK_S;
	}
	double load_target = recipe_etching(state)
			? (state == STATE_ETCH_SF6 ? table[CH_PLATEN_RF_LOAD_CAPACITOR].sf6 : table[CH_PLATEN_RF_LOAD_CAPACITOR].c4f8)
			: table[CH_PLATEN_RF_LOAD_CAPACITOR].idle;
	double tuning_target = recipe_etching(state)
			? (state == STATE_ETCH_SF6 ? table[CH_PLATEN_RF_TUNING_CAPACITOR].sf6 : table[CH_PLATEN_RF_TUNING_CAPACITOR].c4f8)
			: table[CH_PLATEN_RF_TUNING_CAPACITOR].idle;
	chamber->platen_load_capacitor = toward(chamber->platen_load_capacitor,
			load_target + chamber->wall_condition * 0.02, MATCH_LAG);
	chamber->platen_tuning_capacitor = toward(chamber->platen_tuning_capacitor,
			tuning_target - chamber->wall_condition * 0.01, MATCH_LAG);
	/* the wafer is clamped for the stabilization step and stays clamped until the run ends, which is what lets
	 * the plasma strike at all: the interlock refuses a strike onto an unclamped wafer */
	int clamped = state != STATE_IDLE && state != STATE_END && state != STATE_ABORTED;
	chamber->helium_pressure = toward(chamber->helium_pressure,
			clamped ? table[CH_HELIUM_BP_PRESSURE].sf6 : table[CH_HELIUM_BP_PRESSURE].idle, 0.4);

	/* slow correlated movement, one step per tick per channel */
	for (int channel = 0; channel < CHANNEL_COUNT; channel++) {
		if (table[channel].drift > 0.0) {
			chamber->wander[channel] = chamber->wander[channel] * DRIFT_PHI
					+ rng_normal(&chamber->wander_rng) * table[channel].drift;
		}
		else {
			/* slow movement inside a wafer, a third of the spread between wafers at its widest */
			chamber->wander[channel] = chamber->wander[channel] * 0.92
					+ rng_normal(&chamber->wander_rng) * table[channel].spread * 0.12;
		}
	}
}

/* The level a channel sits at in this state, before the chamber's own state is applied. */
static double level_of(const channel_spec_t *spec, recipe_state_t state)
{
	if (state == STATE_ETCH_SF6) {
		return spec->sf6;
	}
	if (state == STATE_ETCH_C4F8) {
		return spec->c4f8;
	}
	return spec->idle;
}

void chamber_read(chamber_t *chamber, recipe_state_t state, const fault_t *fault, double out[CHANNEL_COUNT])
{
	const channel_spec_t *table = channels_table();
	for (int channel = 0; channel < CHANNEL_COUNT; channel++) {
		const channel_spec_t *spec = &table[channel];
		/* a channel the chamber keeps state for is read from that state; the rest sit at their phase level */
		double value;
		switch (channel) {
			case CH_GAS5_FLOW: value = chamber->sf6_flow; break;
			case CH_GAS4_FLOW: value = chamber->c4f8_flow; break;
			case CH_SOURCE_RF_LOAD_POWER: value = chamber->source_power; break;
			case CH_PRESSURE: value = chamber->chamber_pressure; break;
			case CH_FORELINE_PRESSURE: value = chamber->foreline_pressure; break;
			case CH_PLATEN_RF_LOAD_CAPACITOR: value = chamber->platen_load_capacitor; break;
			case CH_PLATEN_RF_TUNING_CAPACITOR: value = chamber->platen_tuning_capacitor; break;
			case CH_HELIUM_BP_PRESSURE: value = chamber->helium_pressure; break;
			default: value = level_of(spec, state); break;
		}
		/* every other channel is read through a sensor, so it carries this run's offset, its wander and its
		 * noise. Without them a state-derived channel would repeat exactly from run to run, band learning would
		 * give it a band of no width, and the smallest departure would score in the millions. The two flows are
		 * the exception: their controllers hold the setpoint, and their variation is the controller's own */
		int controlled = channel == CH_GAS5_FLOW || channel == CH_GAS4_FLOW;
		if (!controlled) {
			value += chamber->run_offset[channel] + chamber->wander[channel];
			if (spec->noise > 0.0) {
				value += rng_normal(&chamber->noise) * spec->noise;
			}
		}
		if (fault_active(fault, chamber->time_s) && fault->channel == channel) {
			if (fault->kind == FAULT_REFLECTED_POWER_RISE) {
				double through = chamber->time_s - fault->start_s;
				double ramp = (fault->duration_s > 0.0) ? through / fault->duration_s : 1.0;
				value += fault->magnitude * (ramp < 1.0 ? ramp : 1.0);
			}
			else if (fault->kind == FAULT_SENSOR_DROPOUT) {
				value = 0.0;
			}
			else if (fault->kind == FAULT_SENSOR_STUCK) {
				value = chamber->last_reported[channel];
			}
		}
		out[channel] = channel_report((channel_t)channel, value);
		chamber->last_reported[channel] = out[channel];
	}
}
