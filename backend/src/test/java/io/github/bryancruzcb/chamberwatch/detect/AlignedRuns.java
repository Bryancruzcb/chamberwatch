package io.github.bryancruzcb.chamberwatch.detect;

import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.IntPredicate;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

import io.github.bryancruzcb.chamberwatch.recipe.AlignedRun;
import io.github.bryancruzcb.chamberwatch.recipe.AlignmentReport;
import io.github.bryancruzcb.chamberwatch.recipe.AlignmentStatus;
import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;
import io.github.bryancruzcb.chamberwatch.recipe.ChannelSet;
import io.github.bryancruzcb.chamberwatch.recipe.Phase;
import io.github.bryancruzcb.chamberwatch.recipe.RecipeGrid;
import io.github.bryancruzcb.chamberwatch.recipe.RunKey;

/**
 * Builds aligned runs directly, for detector tests. Every cycle fills SF6 offsets 0 to 22 and C4F8
 * offsets 0 to 6 on the 6 s rhythm, so consecutive samples are 0.2 s apart like the public wafers.
 */
final class AlignedRuns {

	static final RecipeGrid GRID = RecipeGrid.STANDARD;

	private AlignedRuns() {
	}

	/** A channel's value at one recipe position. */
	interface Signal {

		float at(int cycle, Phase phase, int offset);

	}

	static AlignedRun run(RunKey key, Map<ChannelName, Signal> signals) {
		return run(key, signals, (slot) -> false);
	}

	/** @param dropped slots left empty, as if the record had a gap there */
	static AlignedRun run(RunKey key, Map<ChannelName, Signal> signals, IntPredicate dropped) {
		ChannelSet channels = ChannelSet.of(signals.keySet());
		float[] slotTimes = new float[GRID.slotCount()];
		float[] values = new float[channels.size() * GRID.slotCount()];
		Arrays.fill(slotTimes, Float.NaN);
		Arrays.fill(values, Float.NaN);
		double etchStartS = 30.0;
		for (int cycle = 1; cycle <= GRID.cycles(); cycle++) {
			for (Phase phase : Phase.values()) {
				int filled = (phase == Phase.SF6) ? 23 : 7;
				for (int offset = 0; offset < filled; offset++) {
					if (cycle == GRID.cycles() && phase == Phase.C4F8) {
						continue;
					}
					int slot = GRID.slot(cycle, phase, offset);
					if (dropped.test(slot)) {
						continue;
					}
					double phaseStart = (phase == Phase.SF6) ? 0.0 : 4.6;
					slotTimes[slot] = (float) (etchStartS + (cycle - 1) * 6.0 + phaseStart + offset * 0.2);
					for (int channel = 0; channel < channels.size(); channel++) {
						values[channel * GRID.slotCount() + slot] = signals.get(channels.name(channel)).at(cycle, phase,
								offset);
					}
				}
			}
		}
		AlignmentReport report = new AlignmentReport(AlignmentStatus.ALIGNED, Optional.empty(), 0, etchStartS,
				etchStartS + 600, true, 99, 100, 198, 0, Optional.empty(), 0, 0, 0, 0, 0, List.of());
		return AlignedRun.adopt(key, GRID, channels, values, slotTimes, report);
	}

	static Set<Integer> slots(int cycle, Phase phase, int fromOffset, int toOffset) {
		return IntStream.rangeClosed(fromOffset, toOffset)
			.mapToObj((offset) -> GRID.slot(cycle, phase, offset))
			.collect(Collectors.toSet());
	}

}
