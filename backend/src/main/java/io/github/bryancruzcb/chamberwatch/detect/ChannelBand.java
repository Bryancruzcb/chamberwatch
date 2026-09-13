package io.github.bryancruzcb.chamberwatch.detect;

import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;

/**
 * The good-run band of one channel at every slot of the grid.
 *
 * <p>Where a slot has a band, its sd is positive because the floor was applied when fitting. NaN sd
 * means the slot had too few observations and cannot be scored; the mean may still be there for the
 * chart. The arrays are owned by the band and never written after construction.
 */
public final class ChannelBand {

	private final ChannelName channel;

	private final ChannelRole role;

	private final int goodRuns;

	private final float[] mean;

	private final float[] sd;

	private ChannelBand(ChannelName channel, ChannelRole role, int goodRuns, float[] mean, float[] sd) {
		this.channel = channel;
		this.role = role;
		this.goodRuns = goodRuns;
		this.mean = mean;
		this.sd = sd;
	}

	/** Takes ownership of the arrays without copying. */
	public static ChannelBand adopt(ChannelName channel, ChannelRole role, int goodRuns, float[] mean, float[] sd) {
		if (mean.length != sd.length) {
			throw new IllegalArgumentException(channel + ": mean and sd arrays differ in length");
		}
		return new ChannelBand(channel, role, goodRuns, mean, sd);
	}

	public ChannelName channel() {
		return channel;
	}

	public ChannelRole role() {
		return role;
	}

	/** Good runs that carried this channel. */
	public int goodRuns() {
		return goodRuns;
	}

	public int slotCount() {
		return mean.length;
	}

	public boolean hasBand(int slot) {
		return !Float.isNaN(sd[slot]);
	}

	public float mean(int slot) {
		return mean[slot];
	}

	public float sd(int slot) {
		return sd[slot];
	}

	public float[] copyMean() {
		return mean.clone();
	}

	public float[] copySd() {
		return sd.clone();
	}

}
