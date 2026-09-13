package io.github.bryancruzcb.chamberwatch.store;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

import io.github.bryancruzcb.chamberwatch.detect.GoodRuns;
import io.github.bryancruzcb.chamberwatch.detect.Label;
import io.github.bryancruzcb.chamberwatch.recipe.AlignmentStatus;
import io.github.bryancruzcb.chamberwatch.recipe.RunKey;
import io.github.bryancruzcb.chamberwatch.recipe.Source;

/**
 * Every stored run of one source, read in a single statement, with what the good-run policy needs.
 *
 * @param labelsSeq the highest label sequence among the runs, so a baseline chosen from this roster can be
 *                  told apart from one chosen from newer labels
 */
public record RunRoster(Source source, List<Entry> runs, long labelsSeq) {

	public RunRoster {
		runs = List.copyOf(runs);
	}

	/** @param alignment empty when the run failed alignment and has no slots */
	public record Entry(RunId id, RunKey key, Label label, Optional<AlignmentStatus> alignment) {
	}

	/** A run that failed alignment can be neither fitted nor scored, so it is never a candidate. */
	public List<GoodRuns.Candidate> candidates() {
		return runs.stream()
			.filter((entry) -> entry.alignment().isPresent())
			.map((entry) -> new GoodRuns.Candidate(entry.key(), entry.label(),
					entry.alignment().get() == AlignmentStatus.ALIGNED))
			.toList();
	}

	public Map<RunKey, RunId> ids() {
		return runs.stream().collect(Collectors.toUnmodifiableMap(Entry::key, Entry::id));
	}

}
