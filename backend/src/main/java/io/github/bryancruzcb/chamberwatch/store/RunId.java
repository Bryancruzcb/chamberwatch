package io.github.bryancruzcb.chamberwatch.store;

/** Database id of a run. The natural identity is {@code RunKey}. */
public record RunId(int value) {

	public RunId {
		if (value < 1) {
			throw new IllegalArgumentException("invalid run id " + value);
		}
	}

}
