package io.github.bryancruzcb.chamberwatch.recipe;

import java.util.Objects;

/**
 * One run as recorded: decoded values at the recorded sample times, before alignment. The netCDF
 * reader and the simulator both produce it, so the aligner cannot tell them apart.
 *
 * <p>Values are sample-major, {@code values[sample * channels.size() + channelIndex]}, like the
 * file's {@code data(time, feature)}. Times are strictly increasing seconds after the first sample.
 * The arrays are owned by the run and never written after construction.
 */
public final class RawRun {

	private final RunKey key;

	private final ChannelSet channels;

	private final double[] times;

	private final float[] values;

	private RawRun(RunKey key, ChannelSet channels, double[] times, float[] values) {
		this.key = key;
		this.channels = channels;
		this.times = times;
		this.values = values;
	}

	/**
	 * Copies the arrays and rebases the times so the first sample is at 0. The netCDF unit attribute
	 * claims seconds since 1970, but the values are offsets, so the rebase loses nothing.
	 *
	 * @throws IllegalArgumentException when the run is empty, the lengths disagree, or the times do not strictly increase
	 */
	public static RawRun of(RunKey key, ChannelSet channels, double[] times, float[] values) {
		Objects.requireNonNull(key, "key");
		Objects.requireNonNull(channels, "channels");
		if (times.length == 0 || values.length != times.length * channels.size()) {
			throw new IllegalArgumentException(key.value() + ": " + times.length + " samples do not match "
					+ values.length + " values for " + channels.size() + " channels");
		}
		double[] rebased = new double[times.length];
		for (int i = 0; i < times.length; i++) {
			if (i > 0 && !(times[i] > times[i - 1])) {
				throw new IllegalArgumentException(key.value() + ": times do not increase at sample " + i);
			}
			rebased[i] = times[i] - times[0];
		}
		return new RawRun(key, channels, rebased, values.clone());
	}

	public RunKey key() {
		return key;
	}

	public ChannelSet channels() {
		return channels;
	}

	public int sampleCount() {
		return times.length;
	}

	public double time(int sample) {
		return times[sample];
	}

	public float value(int channelIndex, int sample) {
		return values[sample * channels.size() + channelIndex];
	}

}
