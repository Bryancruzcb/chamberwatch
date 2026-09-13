package io.github.bryancruzcb.chamberwatch.recipe;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * A run on the recipe grid: for each channel one value per slot, and for each slot the recorded time
 * of the sample that filled it. Every detector reads this type.
 *
 * <p>Values are channel-major, {@code values[channelIndex * grid.slotCount() + slot]}. NaN in the
 * slot times means no sample filled the slot, and then every channel's value there is NaN too. The
 * arrays are owned by the run and never written after construction.
 */
public final class AlignedRun {

	private final RunKey key;

	private final RecipeGrid grid;

	private final ChannelSet channels;

	private final float[] values;

	private final float[] slotTimes;

	private final AlignmentReport report;

	private AlignedRun(RunKey key, RecipeGrid grid, ChannelSet channels, float[] values, float[] slotTimes,
			AlignmentReport report) {
		this.key = key;
		this.grid = grid;
		this.channels = channels;
		this.values = values;
		this.slotTimes = slotTimes;
		this.report = report;
	}

	/**
	 * Takes ownership of the arrays without copying. The aligner and the store's decoder use it.
	 *
	 * @throws IllegalArgumentException when the array lengths do not match the grid and the channel set
	 */
	public static AlignedRun adopt(RunKey key, RecipeGrid grid, ChannelSet channels, float[] values, float[] slotTimes,
			AlignmentReport report) {
		if (slotTimes.length != grid.slotCount() || values.length != channels.size() * grid.slotCount()) {
			throw new IllegalArgumentException(key.value() + ": arrays do not match the grid");
		}
		return new AlignedRun(key, grid, channels, values, slotTimes, report);
	}

	public RunKey key() {
		return key;
	}

	public RecipeGrid grid() {
		return grid;
	}

	public ChannelSet channels() {
		return channels;
	}

	public AlignmentReport report() {
		return report;
	}

	/** NaN when the slot is empty. */
	public float value(int channelIndex, int slot) {
		return values[channelIndex * grid.slotCount() + slot];
	}

	/** Seconds after the first recorded sample, NaN when the slot is empty. */
	public double timeAt(int slot) {
		return slotTimes[slot];
	}

	public boolean hasSample(int slot) {
		return !Float.isNaN(slotTimes[slot]);
	}

	/**
	 * Whether the detectors score this cycle: a steady cycle of the grid that is not the run's last. The
	 * last cycle ends the etch with a longer SF6 phase, so in the three wafers with 98 C4F8 phases cycle
	 * 99 looks like cycle 100 of every other wafer.
	 */
	public boolean isScored(int cycle) {
		return grid.isSteady(cycle) && cycle < report.lastCycle();
	}

	public float[] copyProfile(int channelIndex) {
		int from = channelIndex * grid.slotCount();
		return Arrays.copyOfRange(values, from, from + grid.slotCount());
	}

	public float[] copySlotTimes() {
		return slotTimes.clone();
	}

	/** One summary per channel and phase over the scored cycles, ordered by channel, then phase. */
	public List<PhaseSummary> summaries() {
		List<PhaseSummary> summaries = new ArrayList<>(channels.size() * 2);
		for (int channel = 0; channel < channels.size(); channel++) {
			for (Phase phase : Phase.values()) {
				int n = 0;
				double sum = 0;
				double sumOfSquares = 0;
				float min = Float.POSITIVE_INFINITY;
				float max = Float.NEGATIVE_INFINITY;
				for (int cycle = 1; cycle <= grid.cycles(); cycle++) {
					if (!isScored(cycle)) {
						continue;
					}
					for (int offset = 0; offset < grid.capacity(phase); offset++) {
						float x = value(channel, grid.slot(cycle, phase, offset));
						if (Float.isNaN(x)) {
							continue;
						}
						n++;
						sum += x;
						sumOfSquares += (double) x * x;
						min = Math.min(min, x);
						max = Math.max(max, x);
					}
				}
				if (n == 0) {
					continue;
				}
				double mean = sum / n;
				double variance = (n < 2) ? 0 : Math.max(0, (sumOfSquares - n * mean * mean) / (n - 1));
				summaries.add(new PhaseSummary(channels.name(channel), phase, n, mean, Math.sqrt(variance), min, max));
			}
		}
		return summaries;
	}

}
