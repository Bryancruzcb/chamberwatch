package io.github.bryancruzcb.chamberwatch.detect;

import java.util.ArrayList;
import java.util.List;

import io.github.bryancruzcb.chamberwatch.recipe.AlignedRun;
import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;
import io.github.bryancruzcb.chamberwatch.recipe.RecipeGrid;

/**
 * The stuck-value rule over one channel of one run: a channel that reports exactly one value for longer than
 * any good run held one on that channel, by the rule's factor, has stopped updating. The rule is learned from
 * the good runs like the bands are, so a gas flow that reads 0 for every C4F8 phase, which every good run
 * does, never counts.
 *
 * <p>A hold runs over consecutive recorded samples in slot order within the scored cycles, and may cross a
 * phase boundary, since a sensor that stops updating does not know the recipe. An unscored cycle or a
 * recording gap ends it, so a gap can neither join two holds nor confirm one. The same walk measures the
 * good runs when a baseline is fitted.
 */
final class StuckDetector {

	private StuckDetector() {
	}

	/**
	 * @param holds       holds that passed the rule, in slot order
	 * @param longestHold the longest hold in the run, in samples, whether or not it passed the rule
	 */
	record Scan(List<Hold> holds, int longestHold) {
	}

	/** The longest hold of one channel in the run, in samples: what the fitter learns from a good run. */
	static int longestHold(AlignedRun run, int channelIndex) {
		return walk(run, channelIndex, run.channels().name(channelIndex), Integer.MAX_VALUE).longestHold();
	}

	static Scan scan(AlignedRun run, int channelIndex, ChannelBand band, DetectorConfig.StuckRule rule) {
		return walk(run, channelIndex, band.channel(), threshold(band.maxHold(), rule));
	}

	/**
	 * The fewest samples a hold needs to pass the rule: more than the factor times the longest good-run
	 * hold, and at least the rule's minimum.
	 */
	static int threshold(int maxHold, DetectorConfig.StuckRule rule) {
		long byFactor = (long) Math.floor(rule.factor() * maxHold) + 1;
		return (int) Math.min(Integer.MAX_VALUE, Math.max(rule.minSamples(), byFactor));
	}

	private static Scan walk(AlignedRun run, int channelIndex, ChannelName channel, int threshold) {
		RecipeGrid grid = run.grid();
		Walker walker = new Walker(channel, threshold);
		double lastTime = Double.NaN;
		for (int slot = 0; slot < grid.slotCount(); slot++) {
			if (!run.isScored(grid.cycleOf(slot))) {
				walker.end();
				lastTime = Double.NaN;
				continue;
			}
			if (!run.hasSample(slot)) {
				continue;
			}
			double time = run.timeAt(slot);
			if (!Double.isNaN(lastTime) && time - lastTime > grid.gapStepSeconds() + 1e-6) {
				walker.end();
			}
			lastTime = time;
			walker.observe(slot, run.value(channelIndex, slot));
		}
		walker.end();
		return new Scan(walker.holds, walker.longest);
	}

	private static final class Walker {

		private final ChannelName channel;

		private final int threshold;

		private final List<Hold> holds = new ArrayList<>();

		private int longest;

		private int length;

		private int start;

		private int confirm;

		private int last;

		private float held = Float.NaN;

		Walker(ChannelName channel, int threshold) {
			this.channel = channel;
			this.threshold = threshold;
		}

		void observe(int slot, float value) {
			if (length > 0 && value != held) {
				end();
			}
			if (Float.isNaN(value)) {
				return;
			}
			if (length == 0) {
				start = slot;
				held = value;
			}
			length++;
			last = slot;
			if (length == threshold) {
				confirm = slot;
			}
			longest = Math.max(longest, length);
		}

		/** Closes the hold in progress, keeping it as a finding when it passed the rule. */
		void end() {
			if (length >= threshold) {
				holds.add(new Hold(channel, start, confirm, last, length, held));
			}
			length = 0;
			held = Float.NaN;
		}

	}

}
