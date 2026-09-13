package io.github.bryancruzcb.chamberwatch.detect;

import java.util.ArrayList;
import java.util.List;

import io.github.bryancruzcb.chamberwatch.recipe.AlignedRun;
import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;
import io.github.bryancruzcb.chamberwatch.recipe.RecipeGrid;

/**
 * The k-sigma persistence rule over one channel of one run, in one pass over the scored cycles.
 *
 * <p>"Consecutive" means consecutive recorded samples in slot order: empty slots at the end of a phase
 * are unused capacity and are skipped. A streak may cross a phase boundary, and each side is compared
 * with its own band. A step between samples longer than the grid's gap threshold breaks the streak, so
 * a recording gap can neither join two excursions nor confirm one.
 */
final class LimitDetector {

	private LimitDetector() {
	}

	/**
	 * @param excursions  confirmed excursions, in slot order
	 * @param persistentZ the largest |z| the channel held for n consecutive samples, 0 when it never had n
	 *                    in a row; the rule confirms an excursion exactly when this passes k
	 */
	record Scan(List<Excursion> excursions, double persistentZ) {
	}

	static Scan scan(AlignedRun run, int channelIndex, ChannelBand band, DetectorConfig.LimitRule rule) {
		RecipeGrid grid = run.grid();
		Tracker tracker = new Tracker(band.channel(), rule);
		double lastTime = Double.NaN;
		for (int slot = 0; slot < grid.slotCount(); slot++) {
			if (!run.isScored(grid.cycleOf(slot))) {
				tracker.breakRun();
				continue;
			}
			if (!run.hasSample(slot)) {
				continue;
			}
			double time = run.timeAt(slot);
			if (!Double.isNaN(lastTime) && time - lastTime > grid.gapStepSeconds() + 1e-6) {
				tracker.breakRun();
			}
			lastTime = time;
			float value = run.value(channelIndex, slot);
			if (!band.hasBand(slot) || Float.isNaN(value)) {
				tracker.breakRun();
				continue;
			}
			tracker.observe(slot, (value - band.mean(slot)) / band.sd(slot));
		}
		tracker.breakRun();
		return new Scan(tracker.excursions, tracker.persistentZ);
	}

	private static final class Tracker {

		private final ChannelName channel;

		private final double k;

		private final int n;

		private final List<Excursion> excursions = new ArrayList<>();

		/** |z| of the last n samples since the last break, as a ring. */
		private final double[] recent;

		private int unbroken;

		private double persistentZ;

		private int length;

		private int start;

		private int confirm;

		private int last;

		private double peak;

		Tracker(ChannelName channel, DetectorConfig.LimitRule rule) {
			this.channel = channel;
			this.k = rule.k();
			this.n = rule.n();
			this.recent = new double[rule.n()];
		}

		void observe(int slot, double z) {
			recent[unbroken % n] = Math.abs(z);
			unbroken++;
			if (unbroken >= n) {
				double smallest = Double.POSITIVE_INFINITY;
				for (double value : recent) {
					smallest = Math.min(smallest, value);
				}
				persistentZ = Math.max(persistentZ, smallest);
			}
			if (Math.abs(z) <= k) {
				closeStreak();
				return;
			}
			if (length == 0) {
				start = slot;
				peak = z;
			}
			length++;
			last = slot;
			if (Math.abs(z) > Math.abs(peak)) {
				peak = z;
			}
			if (length == n) {
				confirm = slot;
			}
		}

		void breakRun() {
			closeStreak();
			unbroken = 0;
		}

		private void closeStreak() {
			if (length >= n) {
				excursions.add(new Excursion(channel, start, confirm, last, length, peak));
			}
			length = 0;
		}

	}

}
