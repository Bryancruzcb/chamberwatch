package io.github.bryancruzcb.chamberwatch.sim;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import io.github.bryancruzcb.chamberwatch.recipe.Phase;

/**
 * When each step of one simulated run happened, and when the tool took its samples. The structure follows
 * docs/DATA.md: a stabilization step and a short strike step before the etch, three ways to start, cycles
 * of about 4.3 s of SF6 and 1.3 s of C4F8, a final SF6 phase whose gas outlasts the plasma, 5 Hz sampling
 * with 0.01 s of jitter, and a 41 to 45 s recording gap after the etch in 69 of 96 records.
 */
final class Timeline {

	static final double SAMPLE_SECONDS = 0.2;

	enum Kind {

		IDLE, STABILIZE, STRIKE_SF6, STRIKE_C4F8, ETCH, TRANSITION, GAS_TAIL

	}

	/**
	 * @param cycle       the recipe cycle, for ETCH, TRANSITION and GAS_TAIL
	 * @param phase       the phase whose readings apply: a transition keeps the phase that just ended
	 * @param phaseStartS that phase's onset, from which slot offsets count
	 */
	record Span(double startS, double endS, Kind kind, int cycle, Phase phase, double phaseStartS) {
	}

	private final List<Span> spans;

	private final double[] times;

	private final EtchStart start;

	private final int c4f8Phases;

	private final double etchStartS;

	private final double etchEndS;

	private final int powerDipSample;

	private final double powerDipValue;

	private Timeline(List<Span> spans, double[] times, EtchStart start, int c4f8Phases, double etchStartS, double etchEndS,
			int powerDipSample, double powerDipValue) {
		this.spans = spans;
		this.times = times;
		this.start = start;
		this.c4f8Phases = c4f8Phases;
		this.etchStartS = etchStartS;
		this.etchEndS = etchEndS;
		this.powerDipSample = powerDipSample;
		this.powerDipValue = powerDipValue;
	}

	static Timeline draw(Randoms random) {
		double startDraw = random.uniform(0, 96);
		EtchStart start = (startDraw < 65) ? EtchStart.SHORT_SF6 : (startDraw < 75) ? EtchStart.FULL_SF6 : EtchStart.C4F8;
		int c4f8Phases = random.chance(3.0 / 96) ? 98 : 99;
		Spans spans = new Spans();
		spans.add(random.uniform(0, 118), Kind.IDLE);
		spans.add(11.8, Kind.STABILIZE);
		spans.add(6.0, Kind.IDLE);
		spans.add(1.4, Kind.STRIKE_SF6);
		spans.add(10.0, Kind.IDLE);
		if (start == EtchStart.C4F8) {
			spans.add(1.4, Kind.STRIKE_C4F8);
			spans.add(0.2, Kind.IDLE);
			spans.add(1.2, Kind.STRIKE_SF6);
			spans.add(10.6, Kind.IDLE);
		}
		double etchStartS = spans.end;
		// Phase lengths vary less than the ranges in docs/DATA.md, which were read off 0.2 s samples: the
		// sampling adds up to a sample either way, and the aligner's regular-cycle ranges allow for that.
		if (start != EtchStart.C4F8) {
			double length = (start == EtchStart.SHORT_SF6) ? 2.8 : random.uniform(4.25, 4.35);
			spans.phase(length, random.uniform(0.19, 0.21), 1, Phase.SF6);
		}
		for (int cycle = 1; cycle <= c4f8Phases; cycle++) {
			spans.phase(random.uniform(1.25, 1.35), random.uniform(0.19, 0.21), cycle, Phase.C4F8);
			if (cycle < c4f8Phases) {
				spans.phase(random.uniform(4.25, 4.35), random.uniform(0.19, 0.21), cycle + 1, Phase.SF6);
			}
			else {
				double onset = spans.end;
				spans.add(random.uniform(4.45, 4.55), Kind.ETCH, cycle + 1, Phase.SF6, onset);
				spans.add(1.0, Kind.GAS_TAIL, cycle + 1, Phase.SF6, onset);
			}
		}
		double etchEndS = spans.end;
		spans.add(random.uniform(30, 60), Kind.IDLE);
		double gapStartS = Double.NaN;
		double gapEndS = Double.NaN;
		if (random.chance(69.0 / 96)) {
			gapStartS = Math.max(etchEndS + 5, random.uniform(639, 670));
			gapEndS = gapStartS + random.uniform(41, 45);
			double recordEnd = gapEndS + random.uniform(10, 30);
			if (recordEnd > spans.end) {
				spans.add(recordEnd - spans.end, Kind.IDLE);
			}
		}

		double[] times = sampleTimes(random, spans.end, gapStartS, gapEndS);
		int powerDipSample = -1;
		double powerDipValue = 0;
		if (random.chance(56.0 / 96)) {
			List<Span> steady = spans.list.stream()
				.filter((span) -> span.kind() == Kind.ETCH && span.cycle() >= 3 && span.cycle() <= 98)
				.toList();
			Span span = steady.get(random.integer(steady.size()));
			double target = random.uniform(span.startS(), span.endS());
			powerDipValue = random.uniform(300, 950);
			int index = Arrays.binarySearch(times, target);
			index = (index >= 0) ? index : -index - 1;
			if (index < times.length && times[index] < span.endS()) {
				powerDipSample = index;
			}
		}
		return new Timeline(List.copyOf(spans.list), times, start, c4f8Phases, etchStartS, etchEndS, powerDipSample,
				powerDipValue);
	}

	List<Span> spans() {
		return spans;
	}

	double[] times() {
		return times;
	}

	EtchStart start() {
		return start;
	}

	int c4f8Phases() {
		return c4f8Phases;
	}

	double etchStartS() {
		return etchStartS;
	}

	double etchEndS() {
		return etchEndS;
	}

	/** The sample where the source power drops below etch power for one reading, or -1. */
	int powerDipSample() {
		return powerDipSample;
	}

	double powerDipValue() {
		return powerDipValue;
	}

	private static double[] sampleTimes(Randoms random, double endS, double gapStartS, double gapEndS) {
		double[] times = new double[(int) (endS / (SAMPLE_SECONDS - 0.01)) + 2];
		int count = 0;
		for (double time = 0; time < endS; time += SAMPLE_SECONDS + random.uniform(-0.01, 0.01)) {
			if (!(time >= gapStartS && time < gapEndS)) {
				times[count++] = time;
			}
		}
		return Arrays.copyOf(times, count);
	}

	/** Spans laid end to end from time 0. */
	private static final class Spans {

		private final List<Span> list = new ArrayList<>();

		private double end;

		void add(double lengthS, Kind kind) {
			add(lengthS, kind, 0, Phase.SF6, end);
		}

		void add(double lengthS, Kind kind, int cycle, Phase phase, double phaseStartS) {
			list.add(new Span(end, end + lengthS, kind, cycle, phase, phaseStartS));
			end += lengthS;
		}

		/** An etch phase and the transition after it, both counting offsets from the phase's onset. */
		void phase(double lengthS, double transitionS, int cycle, Phase phase) {
			double onset = end;
			add(lengthS, Kind.ETCH, cycle, phase, onset);
			add(transitionS, Kind.TRANSITION, cycle, phase, onset);
		}

	}

}
