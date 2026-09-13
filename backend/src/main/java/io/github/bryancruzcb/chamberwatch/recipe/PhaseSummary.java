package io.github.bryancruzcb.chamberwatch.recipe;

/**
 * One channel's statistics over one phase of a run's steady cycles, ignoring empty slots. The run
 * deviation detector and the lot page both work on these.
 *
 * @param n samples used
 */
public record PhaseSummary(ChannelName channel, Phase phase, int n, double mean, double sd, float min, float max) {
}
