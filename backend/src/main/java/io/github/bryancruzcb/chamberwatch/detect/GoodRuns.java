package io.github.bryancruzcb.chamberwatch.detect;

import java.util.Collection;
import java.util.Collections;
import java.util.SortedSet;
import java.util.TreeSet;

import io.github.bryancruzcb.chamberwatch.recipe.RunKey;

/** The good-run policy, in one place. The chosen set is stored with the baseline it produced. */
public final class GoodRuns {

	private GoodRuns() {
	}

	/**
	 * What the policy needs to know about one run.
	 *
	 * @param aligned whether the run aligned cleanly; degraded and failed runs are good only when labeled GOOD
	 */
	public record Candidate(RunKey key, Label label, boolean aligned) {
	}

	/**
	 * A run is good when it is labeled GOOD, or labeled AUTO, aligned cleanly, and among the first
	 * {@code perLot} wafers of its lot, the ones closest to the chamber clean.
	 *
	 * @return sorted by key, so the same runs always give the same set
	 */
	public static SortedSet<RunKey> select(Collection<Candidate> candidates, int perLot) {
		SortedSet<RunKey> good = new TreeSet<>();
		for (Candidate candidate : candidates) {
			boolean byDefault = candidate.label() == Label.AUTO && candidate.aligned()
					&& candidate.key().positionInLot() <= perLot;
			if (candidate.label() == Label.GOOD || byDefault) {
				good.add(candidate.key());
			}
		}
		return Collections.unmodifiableSortedSet(good);
	}

}
