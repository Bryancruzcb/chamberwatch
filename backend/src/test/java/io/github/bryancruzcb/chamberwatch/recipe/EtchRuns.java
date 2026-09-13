package io.github.bryancruzcb.chamberwatch.recipe;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** Builds raw runs with the public data's etch structure at exact 0.2 s steps, for tests. */
public final class EtchRuns {

	static final double STEP_S = 0.2;

	static final ChannelName GAS1 = ChannelName.of("Gas1Flow");

	static final ChannelName PRESSURE = ChannelName.of("Pressure");

	private static final float ETCH_POWER = 2790;

	private static final float STRIKE_POWER = 142;

	private EtchRuns() {
	}

	public static Builder etch() {
		return new Builder();
	}

	public enum Start {

		/** A 2.8 s SF6 phase right before C4F8 phase 1, as in most public wafers. */
		SHORT_SF6,

		/** A 4.2 s SF6 phase right before C4F8 phase 1. */
		FULL_SF6,

		/** No SF6 phase before C4F8 phase 1. */
		C4F8

	}

	/**
	 * A generated run and the onset times the aligner should find. Index 0 is unused, and
	 * {@code sf6Onsets[1]} is NaN when the etch starts with C4F8.
	 */
	public record Generated(RawRun run, double[] sf6Onsets, double[] c4f8Onsets) {
	}

	public static final class Builder {

		private RunKey key = RunKey.simulated(1, 1, 1);

		private Start start = Start.SHORT_SF6;

		private boolean strike;

		private int c4f8Phases = 99;

		private int stuckSf6FromCycle;

		private int pressureOffsetFromCycle;

		private float pressureOffset;

		private int dipCycle;

		private int irregularCycle;

		private double gapStartS = Double.NaN;

		private double gapLengthS;

		private boolean withGas5 = true;

		public Builder key(RunKey key) {
			this.key = key;
			return this;
		}

		public Builder start(Start start) {
			this.start = start;
			return this;
		}

		/** Adds a low-power strike with C4F8 and SF6 gas steps and a 10.6 s pause before the etch. */
		public Builder strike() {
			this.strike = true;
			return this;
		}

		/** C4F8 phases in the etch; the etch then ends with SF6 phase {@code c4f8Phases + 1}. */
		public Builder c4f8Phases(int c4f8Phases) {
			this.c4f8Phases = c4f8Phases;
			return this;
		}

		/** Gas5Flow reads 250 instead of 600 in the SF6 phases of this cycle and every later one. */
		public Builder stuckSf6From(int cycle) {
			this.stuckSf6FromCycle = cycle;
			return this;
		}

		/** Adds {@code delta} to Pressure in the SF6 phases of this cycle and every later one. */
		public Builder pressureOffsetFrom(int cycle, float delta) {
			this.pressureOffsetFromCycle = cycle;
			this.pressureOffset = delta;
			return this;
		}

		/** Gas5Flow drops to 0 for one sample in the middle of this cycle's SF6 phase. */
		public Builder dipInSf6(int cycle) {
			this.dipCycle = cycle;
			return this;
		}

		/** This cycle runs SF6 for 5.0 s and C4F8 for 0.8 s, like cycle 74 of lot 3 wafer 7. */
		public Builder irregular(int cycle) {
			this.irregularCycle = cycle;
			return this;
		}

		/** Drops every sample from {@code startS} for {@code lengthS} seconds. */
		public Builder gap(double startS, double lengthS) {
			this.gapStartS = startS;
			this.gapLengthS = lengthS;
			return this;
		}

		public Builder withoutGas5() {
			this.withGas5 = false;
			return this;
		}

		public Generated build() {
			List<float[]> rows = new ArrayList<>();
			double[] sf6Onsets = new double[101];
			double[] c4f8Onsets = new double[100];
			Arrays.fill(sf6Onsets, Double.NaN);
			Arrays.fill(c4f8Onsets, Double.NaN);
			repeat(rows, 30, 0, 0, 0, 0.02f, 0);
			repeat(rows, 59, 150, 300, 0, 0.02f, 0);
			repeat(rows, 30, 0, 0, 0, 0.02f, 0);
			repeat(rows, 7, 0, 0, 600, 0.02f, STRIKE_POWER);
			repeat(rows, 50, 0, 0, 0, 0.02f, 0);
			if (strike) {
				repeat(rows, 7, 0, 300, 0, 0.05f, STRIKE_POWER);
				repeat(rows, 1, 0, 0, 0, 0.03f, STRIKE_POWER);
				repeat(rows, 6, 0, 0, 600, 0.04f, STRIKE_POWER);
				repeat(rows, 53, 0, 0, 0, 0.02f, 0);
			}
			int lead = switch (start) {
				case SHORT_SF6 -> 14;
				case FULL_SF6 -> 21;
				case C4F8 -> 0;
			};
			if (lead > 0) {
				sf6Onsets[1] = time(rows.size());
				sf6(rows, 1, lead, 0);
				repeat(rows, 1, 0, 0, 0, 0.03f, ETCH_POWER);
			}
			for (int cycle = 1; cycle <= c4f8Phases; cycle++) {
				c4f8Onsets[cycle] = time(rows.size());
				repeat(rows, (cycle == irregularCycle) ? 4 : 6, 0, 300, 0, 0.05f, ETCH_POWER);
				repeat(rows, 1, 0, 0, 0, 0.03f, ETCH_POWER);
				int next = cycle + 1;
				sf6Onsets[next] = time(rows.size());
				if (cycle == c4f8Phases) {
					// the gas stays on about a second after the plasma stops
					sf6(rows, next, 28, 5);
				}
				else if (next == irregularCycle) {
					sf6(rows, next, 25, 0);
				}
				else {
					sf6(rows, next, 22, 0);
					repeat(rows, 1, 0, 0, 0, 0.03f, ETCH_POWER);
				}
			}
			repeat(rows, 300, 0, 0, 0, 0.02f, 0);
			return new Generated(toRun(rows), sf6Onsets, c4f8Onsets);
		}

		private void sf6(List<float[]> rows, int cycle, int samples, int unpoweredTail) {
			float flow = (stuckSf6FromCycle > 0 && cycle >= stuckSf6FromCycle) ? 250 : 600;
			float pressure = (pressureOffsetFromCycle > 0 && cycle >= pressureOffsetFromCycle) ? 0.04f + pressureOffset
					: 0.04f;
			for (int i = 0; i < samples; i++) {
				boolean dip = cycle == dipCycle && i == samples / 2;
				float power = (i < samples - unpoweredTail) ? ETCH_POWER : 0;
				rows.add(new float[] { 0, 0, dip ? 0 : flow, pressure, power });
			}
		}

		private RawRun toRun(List<float[]> rows) {
			List<ChannelName> names = withGas5
					? List.of(GAS1, ChannelName.GAS4_FLOW, ChannelName.GAS5_FLOW, PRESSURE, ChannelName.SOURCE_RF_LOAD_POWER)
					: List.of(GAS1, ChannelName.GAS4_FLOW, PRESSURE, ChannelName.SOURCE_RF_LOAD_POWER);
			List<Double> times = new ArrayList<>();
			List<Float> values = new ArrayList<>();
			for (int i = 0; i < rows.size(); i++) {
				double t = time(i);
				if (t >= gapStartS && t < gapStartS + gapLengthS) {
					continue;
				}
				times.add(t);
				float[] row = rows.get(i);
				for (int channel = 0; channel < row.length; channel++) {
					if (withGas5 || channel != 2) {
						values.add(row[channel]);
					}
				}
			}
			float[] flat = new float[values.size()];
			for (int i = 0; i < flat.length; i++) {
				flat[i] = values.get(i);
			}
			return RawRun.of(key, ChannelSet.of(names), times.stream().mapToDouble(Double::doubleValue).toArray(), flat);
		}

		/** Row layout follows the sorted channel names: Gas1Flow, Gas4Flow, Gas5Flow, Pressure, SourceRFLoadPower. */
		private static void repeat(List<float[]> rows, int samples, float gas1, float gas4, float gas5, float pressure,
				float power) {
			for (int i = 0; i < samples; i++) {
				rows.add(new float[] { gas1, gas4, gas5, pressure, power });
			}
		}

		private static double time(int index) {
			return index * STEP_S;
		}

	}

}
