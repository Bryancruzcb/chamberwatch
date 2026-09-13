package io.github.bryancruzcb.chamberwatch.store;

import java.time.LocalDate;
import java.util.Optional;

import io.github.bryancruzcb.chamberwatch.recipe.Source;

/**
 * A lot as the lot sheet or the simulator describes it.
 *
 * @param runDate      the day the lot ran, empty for synthetic lots
 * @param conditioning how the chamber was conditioned after its clean, empty for synthetic lots
 */
public record LotRecord(Source source, int lotNo, Optional<LocalDate> runDate, Optional<Conditioning> conditioning) {

	public LotRecord {
		if (source == null || lotNo < 1) {
			throw new IllegalArgumentException("invalid lot " + source + " " + lotNo);
		}
	}

	public enum Surface {

		CHUCK, SILICON, OXIDE

	}

	/** For example, 9 times on a silicon wafer. */
	public record Conditioning(int count, Surface surface) {

		public Conditioning {
			if (count < 1 || surface == null) {
				throw new IllegalArgumentException("invalid conditioning " + count + " " + surface);
			}
		}

	}

}
