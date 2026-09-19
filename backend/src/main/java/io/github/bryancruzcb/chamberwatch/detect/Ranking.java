package io.github.bryancruzcb.chamberwatch.detect;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;

/**
 * The "look here first" order. Channels that left their band or stopped updating come first, earliest
 * departure first, because a later departure is often an effect of an earlier one: a stuck SF6 flow first,
 * the foreline pressure after. The rest follow by their largest run-level |z|.
 */
final class Ranking {

	private Ranking() {
	}

	/** One channel's detector output before it has a rank. */
	record ChannelFindings(ChannelName channel, List<Excursion> excursions, double persistentZ, List<Hold> holds,
			int longestHold, List<ChannelVerdict.SummaryZ> summaryZ) {

		double maxAbsSummaryZ() {
			return summaryZ.stream().mapToDouble((score) -> Math.abs(score.z())).max().orElse(0);
		}

		boolean departed() {
			return !excursions.isEmpty() || !holds.isEmpty();
		}

		/** The slot where the channel first left the band or stopped updating. */
		int departureSlot() {
			int excursion = excursions.isEmpty() ? Integer.MAX_VALUE : excursions.get(0).startSlot();
			int hold = holds.isEmpty() ? Integer.MAX_VALUE : holds.get(0).startSlot();
			return Math.min(excursion, hold);
		}

		/** The first excursion's peak |z|, so two channels leaving at the same slot rank the wilder one first. */
		double departurePeak() {
			return excursions.isEmpty() ? 0 : Math.abs(excursions.get(0).peakZ());
		}

	}

	static List<ChannelVerdict> rank(List<ChannelFindings> findings, double runZ) {
		Comparator<ChannelFindings> departed = Comparator.comparingInt(ChannelFindings::departureSlot)
			.thenComparing((ChannelFindings finding) -> -finding.departurePeak())
			.thenComparing(ChannelFindings::channel);
		Comparator<ChannelFindings> deviating = Comparator
			.comparingDouble((ChannelFindings finding) -> -finding.maxAbsSummaryZ())
			.thenComparing(ChannelFindings::channel);
		List<ChannelFindings> ordered = new ArrayList<>(
				findings.stream().filter(ChannelFindings::departed).sorted(departed).toList());
		ordered.addAll(findings.stream().filter((finding) -> !finding.departed()).sorted(deviating).toList());
		List<ChannelVerdict> verdicts = new ArrayList<>(ordered.size());
		for (int i = 0; i < ordered.size(); i++) {
			ChannelFindings finding = ordered.get(i);
			double maxAbsZ = finding.maxAbsSummaryZ();
			verdicts.add(new ChannelVerdict(finding.channel(), i + 1, finding.excursions(), finding.persistentZ(),
					finding.holds(), finding.longestHold(), finding.summaryZ(), maxAbsZ, maxAbsZ > runZ));
		}
		return verdicts;
	}

}
