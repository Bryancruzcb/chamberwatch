package io.github.bryancruzcb.chamberwatch.recipe;

import java.util.Collection;
import java.util.Collections;
import java.util.List;

/**
 * The channels one run carries, sorted by name. A channel's index is its row in the run's value
 * arrays. Two runs may carry different sets, and code comparing a run with a baseline treats a
 * channel the run lacks as absent, never as anomalous.
 */
public final class ChannelSet {

	private final List<ChannelName> names;

	private ChannelSet(List<ChannelName> names) {
		this.names = names;
	}

	/**
	 * Sorts the names.
	 *
	 * @throws IllegalArgumentException when the collection is empty or names a channel twice
	 */
	public static ChannelSet of(Collection<ChannelName> names) {
		List<ChannelName> sorted = names.stream().sorted().toList();
		if (sorted.isEmpty()) {
			throw new IllegalArgumentException("a run needs at least one channel");
		}
		for (int i = 1; i < sorted.size(); i++) {
			if (sorted.get(i).equals(sorted.get(i - 1))) {
				throw new IllegalArgumentException("channel listed twice: " + sorted.get(i));
			}
		}
		return new ChannelSet(sorted);
	}

	public int size() {
		return names.size();
	}

	/** Row index, or -1 when the run does not carry the channel. */
	public int indexOf(ChannelName name) {
		int index = Collections.binarySearch(names, name);
		return index >= 0 ? index : -1;
	}

	public boolean contains(ChannelName name) {
		return indexOf(name) >= 0;
	}

	public ChannelName name(int index) {
		return names.get(index);
	}

	/** Unmodifiable, in index order. */
	public List<ChannelName> names() {
		return names;
	}

	@Override
	public boolean equals(Object other) {
		return other instanceof ChannelSet set && names.equals(set.names);
	}

	@Override
	public int hashCode() {
		return names.hashCode();
	}

	@Override
	public String toString() {
		return names.toString();
	}

}
