package io.github.bryancruzcb.chamberwatch.ingest;

import java.util.List;

import io.github.bryancruzcb.chamberwatch.recipe.RawRun;
import io.github.bryancruzcb.chamberwatch.recipe.RunKey;

/**
 * Where raw wafer telemetry comes from. Listing keys is separate from reading samples, so the ingest
 * can skip stored wafers without decoding them.
 */
public interface TelemetrySource extends AutoCloseable {

	/** Every wafer in the source, sorted by key. */
	List<RunKey> keys();

	/**
	 * Reads and decodes one wafer: channel names without the file prefix, times rebased to the first
	 * sample, values decoded through the dictionary.
	 *
	 * @throws java.util.NoSuchElementException for a key the source does not hold
	 */
	RawRun read(RunKey key);

	@Override
	void close();

}
