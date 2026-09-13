package io.github.bryancruzcb.chamberwatch.recipe;

/**
 * Which slot each recorded sample of a run filled. The store writes it next to every sample row, so
 * SQL can join raw samples to bands and to recipe positions.
 */
public final class SlotAssignment {

	private final int[] slots;

	SlotAssignment(int[] slots) {
		this.slots = slots;
	}

	public int sampleCount() {
		return slots.length;
	}

	/** The slot the sample filled, or -1 when it lies outside the grid, overflowed a phase, or lost a slot collision. */
	public int slotOf(int sample) {
		return slots[sample];
	}

}
