package io.github.bryancruzcb.chamberwatch.recipe;

/**
 * A telemetry channel name without the file's {@code Stat3_Etch_MV_} prefix, for example
 * {@code PlatenRFTuningCapacitor}. Runs are matched to baselines by name, which is what lets lot 1's
 * 44 channels and the other lots' 31 share a baseline.
 */
public record ChannelName(String value) implements Comparable<ChannelName> {

	public static final String FILE_PREFIX = "Stat3_Etch_MV_";

	/** Marks SF6 phases. */
	public static final ChannelName GAS5_FLOW = new ChannelName("Gas5Flow");

	/** Marks C4F8 phases, and is also high during the gas stabilization step before the etch. */
	public static final ChannelName GAS4_FLOW = new ChannelName("Gas4Flow");

	/** About 2,790 while the etch runs, about 140 during a plasma strike, 0 otherwise. */
	public static final ChannelName SOURCE_RF_LOAD_POWER = new ChannelName("SourceRFLoadPower");

	public ChannelName {
		if (value == null || value.isEmpty() || value.startsWith(FILE_PREFIX)
				|| value.chars().anyMatch(Character::isWhitespace)) {
			throw new IllegalArgumentException("invalid channel name: " + value);
		}
	}

	/** Accepts a name with or without the file prefix. */
	public static ChannelName of(String raw) {
		if (raw == null) {
			throw new IllegalArgumentException("channel name is null");
		}
		return new ChannelName(raw.startsWith(FILE_PREFIX) ? raw.substring(FILE_PREFIX.length()) : raw);
	}

	@Override
	public int compareTo(ChannelName other) {
		return value.compareTo(other.value);
	}

	@Override
	public String toString() {
		return value;
	}

}
