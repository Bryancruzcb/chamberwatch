package io.github.bryancruzcb.chamberwatch.detect;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;

/**
 * The "look here first" order. Channels that left their band come first, earliest departure first,
 * because a later departure is often an effect of an earlier one: a stuck SF6 flow first, chamber
 * pressure after. The rest follow by their largest run-level |z|.
 */
final class Ranking {

	private Ranking() {
	}

	/** One channel's detector output before it has a rank. */
	record ChannelFindings(ChannelName channel, List<Excursion> excursions, double persistentZ,
			List<ChannelVerdict.SummaryZ> summaryZ) {

		double maxAbsSummaryZ() {
			return summaryZ.stream().mapToDouble((score) -> Math.abs(score.z())).max().orElse(0);
		}

	}

	static List<ChannelVerdict> rank(List<ChannelFindings> findings, double runZ) {
		Comparator<ChannelFindings> departed = Comparator
			.comparingInt((ChannelFindings finding) -> finding.excursions().get(0).startSlot())
			.thenComparing((ChannelFindings finding) -> -Math.abs(finding.excursions().get(0).peakZ()))
			.thenComparing(ChannelFindings::channel);
		Comparator<ChannelFindings> deviating = Comparator
			.comparingDouble((ChannelFindings finding) -> -finding.maxAbsSummaryZ())
			.thenComparing(ChannelFindings::channel);
		List<ChannelFindings> ordered = new ArrayList<>(
				findings.stream().filter((finding) -> !finding.excursions().isEmpty()).sorted(departed).toList());
		ordered.addAll(findings.stream().filter((finding) -> finding.excursions().isEmpty()).sorted(deviating).toList());
		List<ChannelVerdict> verdicts = new ArrayList<>(ordered.size());
		for (int i = 0; i < ordered.size(); i++) {
			ChannelFindings finding = ordered.get(i);
			double maxAbsZ = finding.maxAbsSummaryZ();
			verdicts.add(new ChannelVerdict(finding.channel(), i + 1, finding.excursions(), finding.persistentZ(),
					finding.summaryZ(), maxAbsZ, maxAbsZ > runZ));
		}
		return verdicts;
	}

}
