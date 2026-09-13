package io.github.bryancruzcb.chamberwatch.sim;

import java.util.Optional;

import io.github.bryancruzcb.chamberwatch.recipe.RawRun;
import io.github.bryancruzcb.chamberwatch.recipe.RunKey;

/**
 * A simulated run and the truth behind it, which the aligner and the detectors never see.
 *
 * @param c4f8Phases C4F8 phases in the etch, 99 or 98
 * @param etchStartS the first etch phase's onset, seconds after the first sample
 * @param etchEndS   when the last etch phase ended
 */
public record SimulatedRun(RawRun raw, Optional<InjectedFault> fault, EtchStart start, int c4f8Phases, double etchStartS,
		double etchEndS) {

	public RunKey key() {
		return raw.key();
	}

}
