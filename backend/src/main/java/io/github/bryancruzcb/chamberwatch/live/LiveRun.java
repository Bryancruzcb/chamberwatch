package io.github.bryancruzcb.chamberwatch.live;

import java.util.ArrayList;
import java.util.List;

import io.github.bryancruzcb.chamberwatch.recipe.ChannelSet;
import io.github.bryancruzcb.chamberwatch.recipe.RawRun;
import io.github.bryancruzcb.chamberwatch.recipe.RunKey;

/**
 * A run as it arrives, sample by sample, until the simulator says it is over. It holds what the aligner will
 * need and nothing else: the times and the readings, in the layout {@link RawRun} wants.
 *
 * <p>The cap is not a detail. Something on the other end of a socket decides how many samples arrive, and a run
 * of this recipe is about 3,000; a stream that never stops must not be allowed to fill the heap, so the run is
 * refused once it passes the cap.
 *
 * <p>The times arrive counted from the simulator's own first sample, and {@link RawRun} counts from the run's
 * first sample, so the two agree without conversion.
 *
 * <p>Single use, like the other accumulators here: add every sample, then finish once.
 */
public final class LiveRun {

	/** Room for a run half again as long as the recipe, and no more. */
	public static final int MAXIMUM_SAMPLES = 6000;

	private final RunKey key;

	private final ChannelSet channels;

	private final int channelCount;

	/** Where each reading of a sample belongs in the channel set, which sorts its names. */
	private final int[] column;

	private final List<Double> times = new ArrayList<>();

	private final List<float[]> samples = new ArrayList<>();

	private boolean finished;

	public LiveRun(Frame.Hello hello) {
		this.key = hello.key();
		this.channels = ChannelSet.of(hello.channels());
		this.channelCount = hello.channels().size();
		if (channels.size() != channelCount) {
			throw new IllegalArgumentException("the hello names a channel twice");
		}
		this.column = new int[channelCount];
		for (int at = 0; at < channelCount; at++) {
			column[at] = channels.indexOf(hello.channels().get(at));
		}
	}

	public RunKey key() {
		return key;
	}

	public int samples() {
		return samples.size();
	}

	/**
	 * Takes one sample of the stream.
	 *
	 * @throws IllegalArgumentException when the sample does not carry one reading per channel, or its time runs
	 *                                  backwards
	 * @throws IllegalStateException    when the run has already finished, or the stream passed the cap
	 */
	public void add(Frame.Sample sample) {
		if (finished) {
			throw new IllegalStateException("this run has already finished");
		}
		float[] values = sample.values();
		if (values.length != channelCount) {
			throw new IllegalArgumentException(
					"sample " + sample.tick() + " carries " + values.length + " readings, not " + channelCount);
		}
		if (!times.isEmpty() && sample.timeS() < times.get(times.size() - 1)) {
			throw new IllegalArgumentException("sample " + sample.tick() + " goes back in time");
		}
		if (samples.size() >= MAXIMUM_SAMPLES) {
			throw new IllegalStateException(
					"the stream passed " + MAXIMUM_SAMPLES + " samples, which is longer than any run of this recipe");
		}
		times.add(sample.timeS());
		samples.add(values);
	}

	/**
	 * The run, in the shape the aligner reads.
	 *
	 * @throws IllegalStateException when nothing arrived, or when called twice
	 */
	public RawRun finish() {
		if (finished) {
			throw new IllegalStateException("this run has already finished");
		}
		if (samples.isEmpty()) {
			throw new IllegalStateException(key.value() + " carried no samples");
		}
		finished = true;
		double[] recorded = new double[times.size()];
		for (int at = 0; at < recorded.length; at++) {
			recorded[at] = times.get(at);
		}
		float[] values = new float[samples.size() * channelCount];
		for (int sample = 0; sample < samples.size(); sample++) {
			float[] row = samples.get(sample);
			for (int at = 0; at < channelCount; at++) {
				values[sample * channelCount + column[at]] = row[at];
			}
		}
		return RawRun.of(key, channels, recorded, values);
	}

}
