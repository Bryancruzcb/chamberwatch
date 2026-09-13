package io.github.bryancruzcb.chamberwatch.detect;

import java.util.ArrayList;
import java.util.List;

import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;
import io.github.bryancruzcb.chamberwatch.recipe.PhaseSummary;

/** Run-level deviation: z-scores of a run's phase statistics against the good runs. */
final class RunDeviation {

	private RunDeviation() {
	}

	/**
	 * @param summaries the run's summaries for {@code channel} only
	 * @return one entry per phase and statistic that has a summary band
	 */
	static List<ChannelVerdict.SummaryZ> score(ChannelName channel, List<PhaseSummary> summaries, SummaryBands bands) {
		List<ChannelVerdict.SummaryZ> scores = new ArrayList<>();
		for (PhaseSummary summary : summaries) {
			for (SummaryStat stat : SummaryStat.values()) {
				double value = stat.of(summary);
				bands.band(channel, summary.phase(), stat)
					.ifPresent((band) -> scores.add(new ChannelVerdict.SummaryZ(summary.phase(), stat, value, band.z(value))));
			}
		}
		return scores;
	}

}
