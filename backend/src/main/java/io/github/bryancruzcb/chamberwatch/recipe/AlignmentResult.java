package io.github.bryancruzcb.chamberwatch.recipe;

/**
 * Result of {@link Aligner#align(RawRun)}. Detectors take only an {@link AlignedRun}, so a run that
 * failed alignment cannot be scored by mistake.
 */
public sealed interface AlignmentResult permits AlignmentResult.Aligned, AlignmentResult.Failed {

	RunKey key();

	/** For tests and the evaluation, where a failed alignment is itself a bug. */
	default AlignedRun orElseThrow() {
		return switch (this) {
			case Aligned aligned -> aligned.run();
			case Failed failed ->
				throw new IllegalStateException(failed.key().value() + " did not align: " + failed.reason());
		};
	}

	record Aligned(AlignedRun run) implements AlignmentResult {

		@Override
		public RunKey key() {
			return run.key();
		}

	}

	/**
	 * @param reason      why no grid could be fitted
	 * @param sampleCount samples in the record
	 */
	record Failed(RunKey key, String reason, int sampleCount) implements AlignmentResult {
	}

}
