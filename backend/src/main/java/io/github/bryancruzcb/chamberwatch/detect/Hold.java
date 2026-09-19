package io.github.bryancruzcb.chamberwatch.detect;

import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;

/**
 * A stretch where a channel reported one value longer than any good run ever held one: the signature
 * of a sensor or a link that stopped updating.
 *
 * @param startSlot   the first sample of the hold
 * @param confirmSlot the sample at which the hold grew past the stuck rule, when an online monitor would
 *                    raise the alarm
 * @param endSlot     the last sample of the hold
 * @param samples     samples in the hold
 * @param value       the value held
 */
public record Hold(ChannelName channel, int startSlot, int confirmSlot, int endSlot, int samples, float value) {

	public Hold {
		if (!(startSlot <= confirmSlot && confirmSlot <= endSlot) || samples < 1) {
			throw new IllegalArgumentException("invalid hold on " + channel);
		}
	}

}
