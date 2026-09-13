package io.github.bryancruzcb.chamberwatch.detect;

import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;

/**
 * A confirmed stay outside the band: at least {@code n} consecutive recorded samples with {@code |z| > k}.
 *
 * @param startSlot   the first out-of-band sample; ranking orders channels by it
 * @param confirmSlot the n-th consecutive out-of-band sample, when an online monitor would raise the alarm
 * @param endSlot     the last out-of-band sample before the channel returned or scoring ended
 * @param outSamples  samples in the streak
 * @param peakZ       the signed z with the largest magnitude in the streak
 */
public record Excursion(ChannelName channel, int startSlot, int confirmSlot, int endSlot, int outSamples, double peakZ) {

	public Excursion {
		if (!(startSlot <= confirmSlot && confirmSlot <= endSlot) || outSamples < 1) {
			throw new IllegalArgumentException("invalid excursion on " + channel);
		}
	}

	public enum Direction {

		HIGH, LOW

	}

	public Direction direction() {
		return (peakZ > 0) ? Direction.HIGH : Direction.LOW;
	}

}
