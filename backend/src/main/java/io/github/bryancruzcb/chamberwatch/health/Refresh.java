package io.github.bryancruzcb.chamberwatch.health;

import java.util.Locale;
import java.util.Optional;

import io.github.bryancruzcb.chamberwatch.recipe.Source;
import io.github.bryancruzcb.chamberwatch.store.BaselineRef;

/**
 * What one refresh did.
 *
 * @param baseline the baseline it settled on, empty when the source had no good runs to fit
 * @param fitted   whether it fitted a new baseline instead of reusing a stored one
 * @param scored   runs it assessed
 * @param flagged  runs flagged under the baseline, counting runs assessed before this refresh
 * @param current  whether the baseline is current afterwards; false when a refresh that read newer labels
 *                 got there first
 * @param pruned   old baselines deleted
 */
public record Refresh(Source source, Optional<BaselineRef> baseline, boolean fitted, int scored, int flagged,
		boolean current, int pruned) {

	static Refresh nothingToFit(Source source) {
		return new Refresh(source, Optional.empty(), false, 0, 0, false, 0);
	}

	public String describe() {
		return baseline
			.map((ref) -> String.format(Locale.ROOT, "baseline %d: %s from %d good runs, %d runs scored, %d flagged%s",
					ref.id(), fitted ? "fitted" : "reused", ref.goodRuns(), scored, flagged,
					current ? "" : ", not current because a refresh from newer labels won"))
			.orElse("baseline: no good runs to fit");
	}

}
