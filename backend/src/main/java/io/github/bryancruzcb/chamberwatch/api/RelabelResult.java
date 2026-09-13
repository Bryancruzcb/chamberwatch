package io.github.bryancruzcb.chamberwatch.api;

import io.github.bryancruzcb.chamberwatch.health.Refresh;
import io.github.bryancruzcb.chamberwatch.store.BaselineRef;

/**
 * What a relabel did to its source's baseline.
 *
 * @param baselineId the baseline current afterwards, null when the source has no good runs left
 * @param fitted     whether the new label changed the good runs, so a new baseline was fitted
 * @param scored     runs assessed under that baseline by this relabel
 * @param flagged    runs flagged under it
 * @param current    false when a relabel that read newer labels finished first
 */
record RelabelResult(Integer baselineId, Integer goodRuns, boolean fitted, int scored, int flagged, boolean current) {

	static RelabelResult of(Refresh refresh) {
		return new RelabelResult(refresh.baseline().map(BaselineRef::id).orElse(null),
				refresh.baseline().map(BaselineRef::goodRuns).orElse(null), refresh.fitted(), refresh.scored(),
				refresh.flagged(), refresh.current());
	}

}
