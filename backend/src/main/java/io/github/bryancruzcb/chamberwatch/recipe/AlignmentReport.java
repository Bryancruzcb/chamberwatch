package io.github.bryancruzcb.chamberwatch.recipe;

import java.util.List;
import java.util.Optional;

/**
 * What alignment found out about one run. It is stored with the run, so the run page can show why a
 * run is degraded before anyone trusts its flags.
 *
 * @param note                  why the run is degraded, empty when it aligned cleanly
 * @param etchStartS            cycle 1's SF6 onset, or C4F8 phase 1's onset when no SF6 phase comes before it
 * @param etchEndS              end of the last phase of the etch
 * @param cycle1Sf6             whether an SF6 phase came right before C4F8 phase 1
 * @param c4f8Phases            C4F8 phases at etch power in the record: 99 in most public wafers, 98 in three
 * @param lastCycle             the etch's last cycle: 100 in most public wafers, 99 in the three with 98 C4F8 phases
 * @param onsetsDetected        onsets up to the last cycle that were seen in the data, cycle 1's SF6 onset not included
 * @param onsetsPredicted       onsets up to the last cycle that the cycle walk placed instead
 * @param largestGap            the longest recording gap, if the record has one
 * @param preEtchSamples        samples before the etch
 * @param postEtchSamples       samples after the etch
 * @param steadyOverflowSamples samples in cycles 2 to 99 past a phase's slot capacity; any degrades the run
 * @param edgeOverflowSamples   samples in cycles 1 and 100 past a phase's slot capacity
 * @param slotCollisions        samples that landed on a filled slot; the one nearer the slot centre is kept
 * @param irregularCycles       steady cycles whose phase lengths fall outside the usual range
 */
public record AlignmentReport(AlignmentStatus status, Optional<String> note, int sampleCount, double etchStartS,
		double etchEndS, boolean cycle1Sf6, int c4f8Phases, int lastCycle, int onsetsDetected, int onsetsPredicted,
		Optional<Gap> largestGap, int preEtchSamples, int postEtchSamples, int steadyOverflowSamples,
		int edgeOverflowSamples, int slotCollisions, List<Integer> irregularCycles) {

	/**
	 * A step between two samples longer than the grid's gap threshold.
	 *
	 * @param startS     time of the last sample before the gap
	 * @param lengthS    step to the next sample
	 * @param insideEtch whether the gap overlaps the etch
	 */
	public record Gap(double startS, double lengthS, boolean insideEtch) {
	}

	public AlignmentReport {
		irregularCycles = List.copyOf(irregularCycles);
		if ((status == AlignmentStatus.ALIGNED) == note.isPresent()) {
			throw new IllegalArgumentException("a degraded run needs a note, and an aligned run has none");
		}
	}

}
