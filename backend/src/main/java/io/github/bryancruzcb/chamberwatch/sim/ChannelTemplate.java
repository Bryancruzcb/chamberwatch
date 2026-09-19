package io.github.bryancruzcb.chamberwatch.sim;

import java.util.List;
import java.util.Optional;
import java.util.OptionalDouble;

import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;
import io.github.bryancruzcb.chamberwatch.recipe.Phase;

/**
 * How one channel behaved in the public wafers, in the terms the simulator draws from.
 *
 * @param constant    the only value the channel ever read in good runs, empty when it varies
 * @param idle        its typical reading before the etch
 * @param resolution  the smallest step between two of its readings, 0 when it showed too many values to tell
 * @param nonNegative whether every reading was at or above 0
 * @param noiseRho    correlation of the fast noise from one sample to the next
 * @param wanderPhi   correlation of the slow wander from one cycle to the next
 * @param sf6         the SF6 phase, absent for a constant channel
 * @param c4f8        the C4F8 phase, absent for a constant channel
 */
public record ChannelTemplate(ChannelName channel, OptionalDouble constant, double idle, double resolution,
		boolean nonNegative, double noiseRho, double wanderPhi, Optional<PhaseTemplate> sf6, Optional<PhaseTemplate> c4f8) {

	public ChannelTemplate {
		if (constant.isPresent() == (sf6.isPresent() || c4f8.isPresent())) {
			throw new IllegalArgumentException(channel + ": a constant channel has no phases, and a varying one has both");
		}
		if (constant.isEmpty() && (sf6.isEmpty() || c4f8.isEmpty())) {
			throw new IllegalArgumentException(channel + ": a varying channel needs both phases");
		}
	}

	/** @throws IllegalStateException for a constant channel */
	public PhaseTemplate phase(Phase phase) {
		return ((phase == Phase.SF6) ? sf6 : c4f8)
			.orElseThrow(() -> new IllegalStateException(channel + " is constant and has no phases"));
	}

	/**
	 * One phase of one channel. A simulated reading is the profile at its offset, plus the cycle's trend,
	 * plus a lot level, a run level and a drift along the lot, plus slow wander and fast noise.
	 *
	 * @param profile   mean reading at each slot offset of the phase over steady cycles of good runs
	 * @param trend     for cycles 1 to 100, how far the phase's mean sat from the run's mean
	 * @param lotSd     spread of lot levels, a lot's level being where its first three wafers sit
	 * @param runSd     spread of runs around their lot's level and drift
	 * @param drift     for wafer positions 1 on, how far a lot's runs sat from the lot's level, averaged over lots
	 * @param driftScaleSd spread between lots of how much of that profile a lot shows, around 1
	 * @param wanderSd  spread of one cycle's mean around its run's mean, beyond what the fast noise explains
	 * @param noiseSd   spread of single readings around their cycle's shape
	 */
	public record PhaseTemplate(List<Double> profile, List<Double> trend, double lotSd, double runSd, List<Double> drift,
			double driftScaleSd, double wanderSd, double noiseSd) {

		public PhaseTemplate {
			profile = List.copyOf(profile);
			trend = List.copyOf(trend);
			drift = List.copyOf(drift);
			if (drift.isEmpty()) {
				throw new IllegalArgumentException("a phase needs a drift profile of at least one wafer position");
			}
		}

		/** The drift at a wafer position, held flat past the last position the public lots reach. */
		public double driftAt(int position) {
			return drift.get(Math.clamp(position, 1, drift.size()) - 1);
		}

		/** The profile at a fractional offset, interpolated between offsets and held flat past either end. */
		public double profileAt(double offset) {
			if (!(offset > 0)) {
				return profile.get(0);
			}
			int below = (int) Math.floor(offset);
			if (below >= profile.size() - 1) {
				return profile.get(profile.size() - 1);
			}
			double fraction = offset - below;
			return profile.get(below) * (1 - fraction) + profile.get(below + 1) * fraction;
		}

		/** The mean of the profile over offsets {@code from} to {@code to}, inclusive. */
		public double level(int from, int to) {
			double sum = 0;
			for (int offset = from; offset <= to; offset++) {
				sum += profile.get(offset);
			}
			return sum / (to - from + 1);
		}

	}

}
