package io.github.bryancruzcb.chamberwatch.ingest;

import java.util.Locale;

/**
 * What one ingest did. A rerun on the same files reports every wafer as already present and no new
 * sample rows.
 *
 * @param telemetrySkipped     the telemetry file was already COMPLETE in the ingest ledger, so it was not read
 * @param wafersStored         new run rows, failed alignments included
 * @param wafersAlreadyPresent wafers whose run key was already stored
 * @param degraded             stored runs that aligned as DEGRADED
 * @param failed               stored runs that could not be aligned
 * @param sampleRows           sample rows written
 */
public record IngestReport(boolean telemetrySkipped, int wafersStored, int wafersAlreadyPresent, int degraded,
		int failed, long sampleRows) {

	static IngestReport skipped() {
		return new IngestReport(true, 0, 0, 0, 0, 0);
	}

	public String describe() {
		if (telemetrySkipped) {
			return "telemetry: already ingested, nothing read";
		}
		return String.format(Locale.ROOT, "telemetry: %d wafers stored, %d already present, %d degraded, %d failed, %,d sample rows",
				wafersStored, wafersAlreadyPresent, degraded, failed, sampleRows);
	}

}
