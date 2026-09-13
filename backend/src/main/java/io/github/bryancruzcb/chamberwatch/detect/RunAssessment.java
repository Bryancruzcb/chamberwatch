package io.github.bryancruzcb.chamberwatch.detect;

import java.util.List;
import java.util.NoSuchElementException;
import java.util.Optional;

import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;
import io.github.bryancruzcb.chamberwatch.recipe.RunKey;

/** A scored run: one verdict per informative channel it carries, in rank order. */
public record RunAssessment(RunKey run, List<ChannelVerdict> verdicts) {

	public RunAssessment {
		verdicts = List.copyOf(verdicts);
		for (int i = 0; i < verdicts.size(); i++) {
			if (verdicts.get(i).rank() != i + 1) {
				throw new IllegalArgumentException("verdicts must be in rank order 1.." + verdicts.size());
			}
		}
	}

	/** The "look here first" answer: rank 1 when it is flagged, empty for a clean run. */
	public Optional<ChannelName> firstChannel() {
		return verdicts.stream().findFirst().filter(ChannelVerdict::flagged).map(ChannelVerdict::channel);
	}

	/** @throws NoSuchElementException when the channel was not scored */
	public ChannelVerdict verdict(ChannelName channel) {
		return verdicts.stream()
			.filter((verdict) -> verdict.channel().equals(channel))
			.findFirst()
			.orElseThrow(() -> new NoSuchElementException(channel + " was not scored in " + run.value()));
	}

	/** Confirmed excursions across every channel. */
	public int limitFlags() {
		return verdicts.stream().mapToInt((verdict) -> verdict.excursions().size()).sum();
	}

	/** Channels that deviate at run level. */
	public int deviationFlags() {
		return (int) verdicts.stream().filter(ChannelVerdict::deviation).count();
	}

	public boolean flagged() {
		return limitFlags() + deviationFlags() > 0;
	}

	/** The largest persistent |z| of any channel: the run has a limit flag exactly when this passes k. */
	public double maxPersistentZ() {
		return verdicts.stream().mapToDouble(ChannelVerdict::persistentZ).max().orElse(0);
	}

	/** The earliest excursion, which belongs to the rank 1 channel whenever any channel has one. */
	public Optional<Excursion> firstExcursion() {
		return verdicts.stream().findFirst().flatMap(ChannelVerdict::firstExcursion);
	}

}
