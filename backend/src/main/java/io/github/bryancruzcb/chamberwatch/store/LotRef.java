package io.github.bryancruzcb.chamberwatch.store;

import io.github.bryancruzcb.chamberwatch.recipe.Source;

/** A stored lot: its database id and natural key. */
public record LotRef(short id, Source source, int lotNo) {
}
