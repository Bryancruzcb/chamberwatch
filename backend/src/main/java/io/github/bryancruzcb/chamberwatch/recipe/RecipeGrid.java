package io.github.bryancruzcb.chamberwatch.recipe;

/**
 * The recipe as a fixed grid of slots. Slot {@code s} means the same recipe moment in every run and
 * every baseline. SF6 fills slots 0 to 29 of a cycle and C4F8 slots 30 to 39, 4,000 slots in all.
 *
 * <p>This is the only place that does slot arithmetic. Changing a component changes the meaning of
 * every stored slot, so it goes together with a bump of {@link Aligner#VERSION}.
 *
 * @param cycles      etch cycles, 100
 * @param slotSeconds nominal sample period, 0.2 s
 * @param sf6Slots    SF6 capacity: steady phases need at most 25 slots and the last one 30
 * @param c4f8Slots   C4F8 capacity: phases need at most 8 slots
 */
public record RecipeGrid(int cycles, double slotSeconds, int sf6Slots, int c4f8Slots) {

	public static final RecipeGrid STANDARD = new RecipeGrid(100, 0.2, 30, 10);

	public RecipeGrid {
		if (cycles < 3 || !(slotSeconds > 0) || sf6Slots < 1 || c4f8Slots < 1) {
			throw new IllegalArgumentException("invalid recipe grid");
		}
	}

	public int slotsPerCycle() {
		return sf6Slots + c4f8Slots;
	}

	/** Slots per run, and the length of every per-slot array. */
	public int slotCount() {
		return cycles * slotsPerCycle();
	}

	public int firstSlot(Phase phase) {
		return (phase == Phase.SF6) ? 0 : sf6Slots;
	}

	public int capacity(Phase phase) {
		return (phase == Phase.SF6) ? sf6Slots : c4f8Slots;
	}

	/**
	 * Whether a cycle's phases last the same in every wafer. The first and last cycles do not: an etch
	 * can start with a short SF6 phase or none, and it ends with a longer one.
	 */
	public boolean isSteady(int cycle) {
		return cycle >= 2 && cycle <= cycles - 1;
	}

	/** @throws IllegalArgumentException when the cycle is out of range or the offset reaches the phase capacity */
	public int slot(RecipePosition position) {
		return slot(position.cycle(), position.phase(), position.offset());
	}

	/** @throws IllegalArgumentException when the cycle is out of range or the offset reaches the phase capacity */
	public int slot(int cycle, Phase phase, int offset) {
		if (cycle < 1 || cycle > cycles || offset < 0 || offset >= capacity(phase)) {
			throw new IllegalArgumentException("no slot for cycle " + cycle + " " + phase + " offset " + offset);
		}
		return (cycle - 1) * slotsPerCycle() + firstSlot(phase) + offset;
	}

	/** The cycle a slot belongs to, without building a {@link RecipePosition}. */
	public int cycleOf(int slot) {
		if (slot < 0 || slot >= slotCount()) {
			throw new IllegalArgumentException("slot out of range: " + slot);
		}
		return slot / slotsPerCycle() + 1;
	}

	/** Inverse of {@link #slot(RecipePosition)}. */
	public RecipePosition position(int slot) {
		if (slot < 0 || slot >= slotCount()) {
			throw new IllegalArgumentException("slot out of range: " + slot);
		}
		int inCycle = slot % slotsPerCycle();
		Phase phase = (inCycle < sf6Slots) ? Phase.SF6 : Phase.C4F8;
		return new RecipePosition(slot / slotsPerCycle() + 1, phase, inCycle - firstSlot(phase));
	}

	/**
	 * A step between consecutive samples longer than this is a recording gap: two slot periods. The
	 * aligner uses it to find gaps and the limit detector to reset a streak, so the two agree.
	 */
	public double gapStepSeconds() {
		return 2 * slotSeconds;
	}

}
