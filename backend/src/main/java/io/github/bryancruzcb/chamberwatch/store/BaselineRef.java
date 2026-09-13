package io.github.bryancruzcb.chamberwatch.store;

import io.github.bryancruzcb.chamberwatch.recipe.Source;

/**
 * A stored baseline.
 *
 * @param goodRuns how many good runs it was fitted on
 */
public record BaselineRef(int id, Source source, int goodRuns) {
}
