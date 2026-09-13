package io.github.bryancruzcb.chamberwatch.detect;

import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.SortedMap;
import java.util.SortedSet;
import java.util.TreeMap;
import java.util.TreeSet;

import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;
import io.github.bryancruzcb.chamberwatch.recipe.RecipeGrid;
import io.github.bryancruzcb.chamberwatch.recipe.RunKey;

/**
 * What a good run looks like: per channel a band at every slot and a band per summary statistic,
 * plus the configuration and the good runs it came from. Produced by {@link HealthModel#fit}.
 */
public final class Baseline {

	private final RecipeGrid grid;

	private final DetectorConfig config;

	private final SortedSet<RunKey> goodRuns;

	private final SortedMap<ChannelName, ChannelBand> bands;

	private final SummaryBands summaryBands;

	private Baseline(RecipeGrid grid, DetectorConfig config, SortedSet<RunKey> goodRuns,
			SortedMap<ChannelName, ChannelBand> bands, SummaryBands summaryBands) {
		this.grid = grid;
		this.config = config;
		this.goodRuns = goodRuns;
		this.bands = bands;
		this.summaryBands = summaryBands;
	}

	/** @throws IllegalArgumentException when a band's length does not match the grid */
	public static Baseline adopt(RecipeGrid grid, DetectorConfig config, Collection<RunKey> goodRuns,
			Map<ChannelName, ChannelBand> bands, SummaryBands summaryBands) {
		for (ChannelBand band : bands.values()) {
			if (band.slotCount() != grid.slotCount()) {
				throw new IllegalArgumentException(band.channel() + ": band does not match the grid");
			}
		}
		return new Baseline(grid, config, Collections.unmodifiableSortedSet(new TreeSet<>(goodRuns)),
				Collections.unmodifiableSortedMap(new TreeMap<>(bands)), summaryBands);
	}

	public RecipeGrid grid() {
		return grid;
	}

	public DetectorConfig config() {
		return config;
	}

	public SortedSet<RunKey> goodRuns() {
		return goodRuns;
	}

	public Optional<ChannelBand> band(ChannelName channel) {
		return Optional.ofNullable(bands.get(channel));
	}

	/** Every channel's band, sorted by name. */
	public SortedMap<ChannelName, ChannelBand> bands() {
		return bands;
	}

	public SummaryBands summaryBands() {
		return summaryBands;
	}

	/** The channels the detectors score, sorted by name. */
	public List<ChannelName> informativeChannels() {
		return bands.values()
			.stream()
			.filter((band) -> band.role() == ChannelRole.INFORMATIVE)
			.map(ChannelBand::channel)
			.toList();
	}

}
