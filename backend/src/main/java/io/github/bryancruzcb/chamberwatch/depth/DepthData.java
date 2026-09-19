package io.github.bryancruzcb.chamberwatch.depth;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.OptionalDouble;
import java.util.SortedSet;
import java.util.TreeSet;

import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;
import io.github.bryancruzcb.chamberwatch.recipe.Phase;
import io.github.bryancruzcb.chamberwatch.recipe.PhaseSummary;

/**
 * The wafers the depth model learns from and predicts, with the names of their features in order. A feature is
 * one channel's mean or spread over one phase. Only channels every wafer records count, so every wafer has every
 * feature.
 */
public record DepthData(List<String> featureNames, List<DepthSample> samples) {

	public DepthData {
		featureNames = List.copyOf(featureNames);
		samples = List.copyOf(samples);
	}

	/**
	 * One wafer's inputs before they become features.
	 *
	 * @param measuredUm the mean depth over the wafer's measured sites, empty when it was not measured
	 */
	public record Wafer(int runId, int lotNo, int position, Collection<PhaseSummary> summaries,
			OptionalDouble measuredUm) {

		public Wafer {
			summaries = List.copyOf(summaries);
		}

	}

	/** Features in channel-name order, then phase, then mean before spread, named like {@code Pressure/SF6/mean}. */
	public static DepthData of(List<Wafer> wafers) {
		SortedSet<ChannelName> shared = sharedChannels(wafers);
		List<String> names = new ArrayList<>();
		for (ChannelName channel : shared) {
			for (Phase phase : Phase.values()) {
				names.add(channel.value() + "/" + phase.name() + "/mean");
				names.add(channel.value() + "/" + phase.name() + "/spread");
			}
		}
		List<DepthSample> samples = new ArrayList<>();
		for (Wafer wafer : wafers) {
			samples.add(new DepthSample(wafer.runId(), wafer.lotNo(), wafer.position(), features(wafer, shared),
					wafer.measuredUm()));
		}
		return new DepthData(names, samples);
	}

	private static SortedSet<ChannelName> sharedChannels(List<Wafer> wafers) {
		SortedSet<ChannelName> shared = null;
		for (Wafer wafer : wafers) {
			SortedSet<ChannelName> own = new TreeSet<>();
			wafer.summaries().forEach((summary) -> own.add(summary.channel()));
			if (shared == null) {
				shared = own;
			}
			else {
				shared.retainAll(own);
			}
		}
		return (shared == null) ? new TreeSet<>() : shared;
	}

	private static double[] features(Wafer wafer, SortedSet<ChannelName> channels) {
		Map<ChannelName, Map<Phase, PhaseSummary>> byChannel = new HashMap<>();
		for (PhaseSummary summary : wafer.summaries()) {
			byChannel.computeIfAbsent(summary.channel(), (channel) -> new HashMap<>()).put(summary.phase(), summary);
		}
		double[] features = new double[channels.size() * Phase.values().length * 2];
		int index = 0;
		for (ChannelName channel : channels) {
			for (Phase phase : Phase.values()) {
				PhaseSummary summary = byChannel.get(channel).get(phase);
				if (summary == null) {
					throw new IllegalArgumentException("run " + wafer.runId() + " has no " + phase + " summary of " + channel);
				}
				features[index++] = summary.mean();
				features[index++] = summary.sd();
			}
		}
		return features;
	}

}
