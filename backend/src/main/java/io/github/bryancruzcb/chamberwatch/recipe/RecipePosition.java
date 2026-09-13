package io.github.bryancruzcb.chamberwatch.recipe;

/**
 * A moment in the recipe: cycle, phase, and whole slots since the phase onset. The upper bounds come
 * from the grid and are checked by {@link RecipeGrid#slot(RecipePosition)}.
 */
public record RecipePosition(int cycle, Phase phase, int offset) {

	public RecipePosition {
		if (cycle < 1 || phase == null || offset < 0) {
			throw new IllegalArgumentException("invalid recipe position: cycle " + cycle + " " + phase + " offset " + offset);
		}
	}

}
