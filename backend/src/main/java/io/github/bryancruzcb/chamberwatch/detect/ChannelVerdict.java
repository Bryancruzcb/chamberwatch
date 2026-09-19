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
 * @param holds          holds that passed the stuck rule, in slot order
 * @param longestHold    the longest run of one value in the channel, in samples, passed the rule or not
 * @param summaryZ       run-level z-scores per phase and statistic
 * @param maxAbsSummaryZ the largest |z| in {@code summaryZ}, 0 when there are none
 * @param deviation      whether {@code maxAbsSummaryZ} exceeds the run-level threshold
 */
public record ChannelVerdict(ChannelName channel, int rank, List<Excursion> excursions, double persistentZ,
		List<Hold> holds, int longestHold, List<SummaryZ> summaryZ, double maxAbsSummaryZ, boolean deviation) {

	public ChannelVerdict {
		if (rank < 1) {
			throw new IllegalArgumentException("rank must be at least 1");
		}
		excursions = List.copyOf(excursions);
		holds = List.copyOf(holds);
		summaryZ = List.copyOf(summaryZ);
	}

	/** @param z signed, against the good-run band of that summary */
	public record SummaryZ(Phase phase, SummaryStat stat, double value, double z) {
	}

	/** Where a channel first left the band or stopped updating: the earlier of its first excursion and first hold. */
	public record Departure(int startSlot, int confirmSlot) {
	}

	public Optional<Excursion> firstExcursion() {
		return excursions.stream().findFirst();
	}

	public Optional<Hold> firstHold() {
		return holds.stream().findFirst();
	}

	/** The earliest departure of either kind, empty when the channel only deviates at run level or is clean. */
	public Optional<Departure> firstDeparture() {
		Optional<Departure> excursion = firstExcursion().map((e) -> new Departure(e.startSlot(), e.confirmSlot()));
		Optional<Departure> hold = firstHold().map((h) -> new Departure(h.startSlot(), h.confirmSlot()));
		if (excursion.isEmpty() || hold.isEmpty()) {
			return excursion.isPresent() ? excursion : hold;
		}
		return (hold.get().startSlot() < excursion.get().startSlot()) ? hold : excursion;
	}

	/** True when any detector flagged the channel. */
	public boolean flagged() {
		return !excursions.isEmpty() || !holds.isEmpty() || deviation;
	}

}
