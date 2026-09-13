package io.github.bryancruzcb.chamberwatch.detect;

import java.util.List;
import java.util.Optional;

import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;
import io.github.bryancruzcb.chamberwatch.recipe.Phase;

/**
 * Everything the detectors concluded about one channel of one run.
 *
 * @param rank           1-based place in the run's "look here first" order
 * @param excursions     confirmed limit excursions, in slot order
 * @param persistentZ    the largest |z| the channel held for n consecutive samples, 0 when it never had
 *                       n in a row; there are excursions exactly when this passes k
 * @param summaryZ       run-level z-scores per phase and statistic
 * @param maxAbsSummaryZ the largest |z| in {@code summaryZ}, 0 when there are none
 * @param deviation      whether {@code maxAbsSummaryZ} exceeds the run-level threshold
 */
public record ChannelVerdict(ChannelName channel, int rank, List<Excursion> excursions, double persistentZ,
		List<SummaryZ> summaryZ, double maxAbsSummaryZ, boolean deviation) {

	public ChannelVerdict {
		if (rank < 1) {
			throw new IllegalArgumentException("rank must be at least 1");
		}
		excursions = List.copyOf(excursions);
		summaryZ = List.copyOf(summaryZ);
	}

	/** @param z signed, against the good-run band of that summary */
	public record SummaryZ(Phase phase, SummaryStat stat, double value, double z) {
	}

	public Optional<Excursion> firstExcursion() {
		return excursions.stream().findFirst();
	}

	/** True when either detector flagged the channel. */
	public boolean flagged() {
		return !excursions.isEmpty() || deviation;
	}

}
