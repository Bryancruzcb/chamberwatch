package io.github.bryancruzcb.chamberwatch.api;

import io.github.bryancruzcb.chamberwatch.health.RefreshQueue;
import io.github.bryancruzcb.chamberwatch.recipe.Source;

/**
 * A refresh that a relabel started, as the API reports it.
 *
 * @param state  {@code RUNNING} while it is queued or working, then {@code DONE} or {@code FAILED}
 * @param result what it did to the source's baseline, once it is {@code DONE}
 * @param error  why it failed, once it {@code FAILED}; the label is kept, and the next relabel, ingest or
 *               simulate-lot refreshes the source again
 */
record RefreshReport(long id, Source source, RefreshQueue.State state, RelabelResult result, String error) {

	static RefreshReport of(RefreshQueue.Status status) {
		return new RefreshReport(status.id(), status.source(), status.state(),
				status.refresh().map(RelabelResult::of).orElse(null), status.error().orElse(null));
	}

}
