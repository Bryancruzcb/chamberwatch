package io.github.bryancruzcb.chamberwatch.ingest;

import java.util.List;
import java.util.Locale;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import io.github.bryancruzcb.chamberwatch.health.Refresh;
import io.github.bryancruzcb.chamberwatch.store.MeasurementSet;

/**
 * What one ingest did. A rerun on the same files reports every file as already ingested and reuses the
 * baseline without scoring anything.
 */
public record IngestReport(TelemetryLoad telemetry, List<MeasurementLoad> measurements, Refresh refresh) {

	public IngestReport {
		measurements = List.copyOf(measurements);
	}

	/** True when a wafer could not be aligned or a measurement matched no stored run. */
	public boolean hasProblems() {
		return telemetry.failed() > 0 || measurements.stream().anyMatch((load) -> load.rowsWithoutRun() > 0);
	}

	public String describe() {
		return Stream
			.concat(Stream.concat(Stream.of(telemetry.describe()), measurements.stream().map(MeasurementLoad::describe)),
					Stream.of(refresh.describe()))
			.collect(Collectors.joining(System.lineSeparator()));
	}

	/**
	 * @param skipped              the ledger already marked the file COMPLETE, so it was not read
	 * @param wafersStored         new run rows, failed alignments included
	 * @param wafersAlreadyPresent wafers whose run key was already stored
	 * @param degraded             stored runs that aligned as DEGRADED
	 * @param failed               stored runs that could not be aligned
	 * @param sampleRows           sample rows written
	 */
	public record TelemetryLoad(boolean skipped, int wafersStored, int wafersAlreadyPresent, int degraded, int failed,
			long sampleRows) {

		static TelemetryLoad alreadyIngested() {
			return new TelemetryLoad(true, 0, 0, 0, 0, 0);
		}

		String describe() {
			if (skipped) {
				return "telemetry: already ingested, nothing read";
			}
			return String.format(Locale.ROOT,
					"telemetry: %d wafers stored, %d already present, %d degraded, %d failed, %,d sample rows",
					wafersStored, wafersAlreadyPresent, degraded, failed, sampleRows);
		}

	}

	/**
	 * @param skipped             the ledger already marked the file COMPLETE, so it was not read
	 * @param rowsStored          measurement rows written
	 * @param rowsAlreadyPresent  rows whose run, set and point were already stored
	 * @param blankKeyRowsSkipped rows without an experiment key
	 * @param rowsWithoutRun      rows whose experiment key matched no stored run
	 */
	public record MeasurementLoad(MeasurementSet set, boolean skipped, int rowsStored, int rowsAlreadyPresent,
			int blankKeyRowsSkipped, int rowsWithoutRun) {

		static MeasurementLoad alreadyIngested(MeasurementSet set) {
			return new MeasurementLoad(set, true, 0, 0, 0, 0);
		}

		String describe() {
			String name = set.name().toLowerCase(Locale.ROOT).replace('_', '-');
			if (skipped) {
				return name + " measurements: already ingested, nothing read";
			}
			return String.format(Locale.ROOT,
					"%s measurements: %,d rows stored, %,d already present, %d rows without a key skipped, %d rows without a run",
					name, rowsStored, rowsAlreadyPresent, blankKeyRowsSkipped, rowsWithoutRun);
		}

	}

}
