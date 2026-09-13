package io.github.bryancruzcb.chamberwatch.detect;

import java.util.Map;
import java.util.Optional;

import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;
import io.github.bryancruzcb.chamberwatch.recipe.Phase;

/** The good-run summary bands of one baseline, by channel, phase and statistic. */
public final class SummaryBands {

	private final Map<Key, SummaryBand> bands;

	private SummaryBands(Map<Key, SummaryBand> bands) {
		this.bands = bands;
	}

	public static SummaryBands of(Map<Key, SummaryBand> bands) {
		return new SummaryBands(Map.copyOf(bands));
	}

	public Optional<SummaryBand> band(ChannelName channel, Phase phase, SummaryStat stat) {
		return Optional.ofNullable(bands.get(new Key(channel, phase, stat)));
	}

	/** Unmodifiable. */
	public Map<Key, SummaryBand> asMap() {
		return bands;
	}

	public record Key(ChannelName channel, Phase phase, SummaryStat stat) {
	}

}
