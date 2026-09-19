package io.github.bryancruzcb.chamberwatch.sim;

import java.util.List;
import java.util.Optional;
import java.util.stream.IntStream;
import java.util.stream.Stream;

import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;
import io.github.bryancruzcb.chamberwatch.recipe.ChannelSet;
import io.github.bryancruzcb.chamberwatch.recipe.Phase;
import io.github.bryancruzcb.chamberwatch.recipe.RawRun;
import io.github.bryancruzcb.chamberwatch.recipe.RecipeGrid;
import io.github.bryancruzcb.chamberwatch.recipe.RunKey;

/**
 * Makes runs that look like the public wafers, from a template, with known faults. A seed, a lot and a
 * wafer position decide a run completely, so runs can be made in any order or in parallel.
 *
 * <p>A reading during the etch is the template's profile at its phase offset, plus the cycle's trend, a lot
 * level drawn once per lot, a drift along wafer position drawn once per lot, a run level, slow wander from
 * cycle to cycle and fast noise from sample to sample, then clamped at 0 where the channel never went
 * negative and rounded to the channel's resolution. The marker channels switch cleanly between their phase
 * levels, as they do in every public wafer, so the aligner sees the same structure. Channels do not affect
 * each other: a stuck gas flow does not move the pressure.
 */
public final class Simulator {

	private static final ChannelName GAS1_FLOW = ChannelName.of("Gas1Flow");

	private static final ChannelName PRESSURE = ChannelName.of("Pressure");

	/** Gas1Flow and Gas4Flow during the stabilization step before the etch. */
	private static final double STABILIZE_GAS1_FLOW = 150;

	private static final double STABILIZE_GAS4_FLOW = 300;

	/** Source power during a plasma strike. */
	private static final double STRIKE_POWER = 142;

	private final long seed;

	private final SimulatorSettings settings;

	private final ChannelSet channels;

	private final ChannelTemplate[] templates;

	/** Per channel, the swings good public runs showed on it. */
	private final List<List<SimulationTemplate.Swing>> swings;

	private final int swingRuns;

	/** Per channel and phase, the spread of one reading across runs that the template implies: a swing's unit. */
	private final double[][] bandSds;

	private final int gas1;

	private final int gas4;

	private final int gas5;

	private final int power;

	private final double pressureLevel;

	private Simulator(long seed, SimulationTemplate template, SimulatorSettings settings) {
		this.seed = seed;
		this.settings = settings;
		this.channels = ChannelSet.of(template.channels().keySet());
		this.templates = channels.names().stream().map(template::channel).toArray(ChannelTemplate[]::new);
		this.swings = channels.names().stream().map((name) -> template.swings().of(name)).toList();
		this.swingRuns = template.swings().goodRuns();
		this.bandSds = new double[templates.length][Phase.values().length];
		for (int c = 0; c < templates.length; c++) {
			if (templates[c].constant().isPresent()) {
				continue;
			}
			for (Phase phase : Phase.values()) {
				bandSds[c][phase.ordinal()] = TemplateBuilder.bandSd(templates[c].phase(phase));
			}
		}
		this.gas1 = required(GAS1_FLOW);
		this.gas4 = required(ChannelName.GAS4_FLOW);
		this.gas5 = required(ChannelName.GAS5_FLOW);
		this.power = required(ChannelName.SOURCE_RF_LOAD_POWER);
		this.pressureLevel = coreLevel(template.channel(PRESSURE), Phase.SF6);
	}

	public static Simulator seeded(long seed, SimulationTemplate template) {
		return seeded(seed, template, SimulatorSettings.DEFAULT);
	}

	public static Simulator seeded(long seed, SimulationTemplate template, SimulatorSettings settings) {
		return new Simulator(seed, template, settings);
	}

	public long seed() {
		return seed;
	}

	public ChannelSet channels() {
		return channels;
	}

	/** Clean wafers 1 to 3 of lots 1, 2, 3 and on, in that order: the good runs a baseline learns from. */
	public Stream<SimulatedRun> cleanTrainingRuns(int count) {
		return IntStream.range(0, count).mapToObj((i) -> run(RunSpec.clean(i / 3 + 1, i % 3 + 1)));
	}

	public SimulatedRun run(RunSpec spec) {
		Timeline timeline = Timeline.draw(Randoms.of(seed, spec.lotNo(), spec.position(), 1));
		Randoms lotDraws = Randoms.of(seed, spec.lotNo(), 0, 2);
		Randoms runDraws = Randoms.of(seed, spec.lotNo(), spec.position(), 3);
		Randoms noiseDraws = Randoms.of(seed, spec.lotNo(), spec.position(), 4);
		Randoms swingDraws = Randoms.of(seed, spec.lotNo(), spec.position(), 5);
		int channelCount = channels.size();
		int cycles = RecipeGrid.STANDARD.cycles();
		double[][] shifts = new double[channelCount][Phase.values().length];
		double[][] wander = new double[channelCount][];
		double[][] swung = new double[channelCount][];
		double[] noise = new double[channelCount];
		for (int c = 0; c < channelCount; c++) {
			ChannelTemplate template = templates[c];
			double lotLevel = lotDraws.unitT(settings.lotDegreesOfFreedom());
			double drift = lotDraws.gaussian();
			double runLevel = runDraws.gaussian();
			if (template.constant().isPresent()) {
				continue;
			}
			for (Phase phase : Phase.values()) {
				ChannelTemplate.PhaseTemplate p = template.phase(phase);
				shifts[c][phase.ordinal()] = p.lotSd() * lotLevel
						+ (p.driftMean() + p.driftSd() * drift) * (spec.position() - 2) + p.runSd() * runLevel;
			}
			wander[c] = autoregressive(runDraws, template.wanderPhi(), cycles + 1);
			swung[c] = swings(swingDraws, swings.get(c), cycles);
			noise[c] = noiseDraws.gaussian();
		}

		Optional<InjectedFault> fault = spec.fault().map((plan) -> inject(plan, timeline));
		int faultChannel = fault.map((f) -> channels.indexOf(f.channel())).orElse(-1);
		double[] times = timeline.times();
		float[] values = new float[times.length * channelCount];
		List<Timeline.Span> spans = timeline.spans();
		int spanIndex = 0;
		boolean stuck = fault.map((f) -> f.kind() == FaultKind.SENSOR_STUCK).orElse(false);
		float lastRecorded = Float.NaN;
		float held = Float.NaN;
		for (int sample = 0; sample < times.length; sample++) {
			double time = times[sample];
			while (spanIndex + 1 < spans.size() && time >= spans.get(spanIndex + 1).startS()) {
				spanIndex++;
			}
			Timeline.Span span = spans.get(spanIndex);
			for (int c = 0; c < channelCount; c++) {
				ChannelTemplate template = templates[c];
				double value;
				if (template.constant().isPresent()) {
					value = template.constant().getAsDouble();
				}
				else {
					double rho = template.noiseRho();
					if (sample > 0) {
						noise[c] = rho * noise[c] + Math.sqrt(1 - rho * rho) * noiseDraws.gaussian();
					}
					value = reading(c, template, span, time, shifts[c], wander[c], swung[c], noise[c]);
				}
				if (c == faultChannel) {
					value = applyFault(fault.get(), value, time);
				}
				float recorded = round(template, value);
				if (c == faultChannel && stuck && time >= fault.get().startS() && time < fault.get().endS()) {
					// the sensor stopped updating: every sample repeats the last value it recorded before the fault
					if (Float.isNaN(held)) {
						held = Float.isNaN(lastRecorded) ? recorded : lastRecorded;
					}
					recorded = held;
				}
				values[sample * channelCount + c] = recorded;
				if (c == faultChannel) {
					lastRecorded = recorded;
				}
			}
		}
		if (timeline.powerDipSample() >= 0) {
			values[timeline.powerDipSample() * channelCount + power] = (float) timeline.powerDipValue();
		}
		RawRun raw = RawRun.of(RunKey.simulated(seed, spec.lotNo(), spec.position()), channels, times, values);
		return new SimulatedRun(raw, fault, timeline.start(), timeline.c4f8Phases(), timeline.etchStartS(),
				timeline.etchEndS());
	}

	private double reading(int c, ChannelTemplate template, Timeline.Span span, double time, double[] shift,
			double[] wander, double[] swung, double noise) {
		return switch (span.kind()) {
			case IDLE -> template.idle();
			case STABILIZE -> (c == gas1) ? STABILIZE_GAS1_FLOW : (c == gas4) ? STABILIZE_GAS4_FLOW : template.idle();
			case STRIKE_SF6 -> (c == gas5) ? coreLevel(template, Phase.SF6) : (c == power) ? STRIKE_POWER : template.idle();
			case STRIKE_C4F8 -> (c == gas4) ? coreLevel(template, Phase.C4F8) : (c == power) ? STRIKE_POWER : template.idle();
			case ETCH, TRANSITION, GAS_TAIL -> etchReading(c, template, span, time, shift, wander, swung, noise);
		};
	}

	private double etchReading(int c, ChannelTemplate template, Timeline.Span span, double time, double[] shift,
			double[] wander, double[] swung, double noise) {
		Phase phase = span.phase();
		ChannelTemplate.PhaseTemplate p = template.phase(phase);
		double variation = shift[phase.ordinal()] + p.trend().get(span.cycle() - 1) + p.wanderSd() * wander[span.cycle()]
				+ swung[span.cycle()] * bandSds[c][phase.ordinal()] + p.noiseSd() * noise;
		if (c == gas5 || c == gas4) {
			Phase gasPhase = (c == gas5) ? Phase.SF6 : Phase.C4F8;
			if (span.kind() == Timeline.Kind.TRANSITION || phase != gasPhase) {
				return coreLevel(template, (gasPhase == Phase.SF6) ? Phase.C4F8 : Phase.SF6);
			}
			return coreLevel(template, gasPhase) + variation;
		}
		if (c == power) {
			return (span.kind() == Timeline.Kind.GAS_TAIL) ? template.idle() : coreLevel(template, phase) + variation;
		}
		return p.profileAt((time - span.phaseStartS()) / Timeline.SAMPLE_SECONDS) + variation;
	}

	private InjectedFault inject(FaultPlan plan, Timeline timeline) {
		double startS = timeline.etchStartS() + plan.startS();
		double endS = switch (plan.kind()) {
			case GAS_FLOW_STUCK_LOW, REFLECTED_POWER_RISE -> timeline.etchEndS();
			case PRESSURE_SPIKE, SENSOR_DROPOUT, SENSOR_STUCK -> Math.min(timeline.etchEndS(), startS + plan.durationS());
		};
		if (!(startS < timeline.etchEndS())) {
			throw new IllegalArgumentException(plan.kind() + " starts after the etch has ended");
		}
		return new InjectedFault(plan, startS, endS);
	}

	private double applyFault(InjectedFault fault, double value, double time) {
		if (time < fault.startS() || time >= fault.endS()) {
			return value;
		}
		double magnitude = fault.plan().magnitude();
		return switch (fault.kind()) {
			case GAS_FLOW_STUCK_LOW -> value * magnitude;
			case PRESSURE_SPIKE -> value + magnitude * pressureLevel;
			// the plan's duration is the ramp, and the full rise holds after it
			case REFLECTED_POWER_RISE -> value + magnitude * Math.min(1, (time - fault.startS()) / fault.plan().durationS());
			case SENSOR_DROPOUT -> 0;
			// the reading is replaced after rounding, with the last value the channel recorded, in run()
			case SENSOR_STUCK -> value;
		};
	}

	private static float round(ChannelTemplate template, double value) {
		double rounded = (template.nonNegative() && value < 0) ? 0 : value;
		if (template.resolution() > 0) {
			rounded = Math.rint(rounded / template.resolution()) * template.resolution();
		}
		return (float) rounded;
	}

	/**
	 * For cycles 0 to {@code cycles}, how far swings move one channel's readings, in band standard deviations.
	 * Swings arrive at the rate good public runs showed on that channel, start in a steady cycle, and each
	 * copies the length and size of one of that channel's public swings, with a random sign.
	 */
	private double[] swings(Randoms draws, List<SimulationTemplate.Swing> observed, int cycles) {
		double[] perCycle = new double[cycles + 1];
		int count = draws.poisson(settings.swingRateScale() * observed.size() / swingRuns);
		for (int i = 0; i < count; i++) {
			SimulationTemplate.Swing swing = observed.get(draws.integer(observed.size()));
			int start = 2 + draws.integer(cycles - 2);
			double size = draws.chance(0.5) ? Math.abs(swing.size()) : -Math.abs(swing.size());
			for (int cycle = start; cycle < Math.min(cycles, start + swing.cycles()); cycle++) {
				perCycle[cycle] += size;
			}
		}
		return perCycle;
	}

	/** A unit-variance AR(1) series with lag-1 correlation phi. */
	private static double[] autoregressive(Randoms draws, double phi, int length) {
		double[] series = new double[length];
		double innovation = Math.sqrt(1 - phi * phi);
		series[0] = draws.gaussian();
		for (int i = 1; i < length; i++) {
			series[i] = phi * series[i - 1] + innovation * draws.gaussian();
		}
		return series;
	}

	private static double coreLevel(ChannelTemplate template, Phase phase) {
		int[] core = TemplateBuilder.CORE[phase.ordinal()];
		return template.phase(phase).level(core[0], core[1]);
	}

	private int required(ChannelName name) {
		int index = channels.indexOf(name);
		if (index < 0) {
			throw new IllegalArgumentException("the simulation template has no " + name);
		}
		return index;
	}

}
