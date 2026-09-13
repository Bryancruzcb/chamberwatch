package io.github.bryancruzcb.chamberwatch.ingest;

import java.nio.file.Path;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import io.github.bryancruzcb.chamberwatch.recipe.Aligner;
import io.github.bryancruzcb.chamberwatch.recipe.AlignmentResult;
import io.github.bryancruzcb.chamberwatch.recipe.AlignmentStatus;
import io.github.bryancruzcb.chamberwatch.recipe.RawRun;
import io.github.bryancruzcb.chamberwatch.recipe.RunKey;
import io.github.bryancruzcb.chamberwatch.store.LotRecord;
import io.github.bryancruzcb.chamberwatch.store.LotRef;
import io.github.bryancruzcb.chamberwatch.store.MeasurementRecord;
import io.github.bryancruzcb.chamberwatch.store.MeasurementSet;
import io.github.bryancruzcb.chamberwatch.store.MeasurementStore;
import io.github.bryancruzcb.chamberwatch.store.RunId;
import io.github.bryancruzcb.chamberwatch.store.RunStore;

import org.springframework.stereotype.Service;

/**
 * Loads the public files into PostgreSQL: lots, then telemetry, then both measurement files. Safe to
 * rerun at any point. Each file has a ledger row, each wafer commits in its own transaction, and a
 * wafer whose run key is stored is skipped without being decoded, so a rerun resumes and adds nothing.
 */
@Service
public class IngestService {

	static final String LOT_STATUS = "Lot_status.xlsx";

	static final String NINE_POINT_CSV = "Si_Oxide_etch_9_points.csv";

	static final String EIGHTY_NINE_POINT_CSV = "Si_Oxide_etch_89_points.csv";

	/** Measurement rows do not depend on the aligner, so their ledger rows carry version 0. */
	private static final int NO_ALIGNER = 0;

	private final RunStore runs;

	private final MeasurementStore measurements;

	public IngestService(RunStore runs, MeasurementStore measurements) {
		this.runs = runs;
		this.measurements = measurements;
	}

	public IngestReport ingestPublic(Path dataDir, Path md5List) {
		Map<String, DataFiles.VerifiedFile> files = DataFiles.verify(dataDir, md5List, List.of(AlignCommand.PROCESS_DATA,
				AlignCommand.DICTIONARY, LOT_STATUS, NINE_POINT_CSV, EIGHTY_NINE_POINT_CSV));
		for (LotRecord lot : LotSheet.read(files.get(LOT_STATUS))) {
			runs.upsertLot(lot);
		}
		IngestReport.TelemetryLoad telemetry = loadTelemetry(files.get(AlignCommand.PROCESS_DATA),
				files.get(AlignCommand.DICTIONARY), runs.publicLotsByDay());
		return new IngestReport(telemetry,
				List.of(loadMeasurements(files.get(NINE_POINT_CSV), MeasurementSet.NINE_POINT),
						loadMeasurements(files.get(EIGHTY_NINE_POINT_CSV), MeasurementSet.EIGHTY_NINE_POINT)));
	}

	private IngestReport.TelemetryLoad loadTelemetry(DataFiles.VerifiedFile processData,
			DataFiles.VerifiedFile dictionary, Map<LocalDate, LotRef> lotsByDay) {
		if (runs.ledger(processData.md5(), Aligner.VERSION) == RunStore.LedgerStatus.COMPLETE) {
			return IngestReport.TelemetryLoad.alreadyIngested();
		}
		runs.markStarted(processData.md5(), Aligner.VERSION, AlignCommand.PROCESS_DATA, processData.bytes());
		int stored = 0;
		int present = 0;
		int degraded = 0;
		int failed = 0;
		long sampleRows = 0;
		try (NetcdfTelemetrySource source = NetcdfTelemetrySource.open(processData, dictionary)) {
			for (RunKey key : source.keys()) {
				if (runs.exists(key)) {
					present++;
					continue;
				}
				LotRef lot = key.day()
					.map(lotsByDay::get)
					.orElseThrow(() -> new IllegalStateException(LOT_STATUS + " has no lot for " + key.value()));
				RawRun raw = source.read(key);
				AlignmentResult result = Aligner.STANDARD.align(raw);
				if (runs.insertIfAbsent(raw, result, lot).isEmpty()) {
					present++;
					continue;
				}
				stored++;
				sampleRows += (long) raw.sampleCount() * raw.channels().size();
				switch (result) {
					case AlignmentResult.Failed ignored -> failed++;
					case AlignmentResult.Aligned aligned -> {
						if (aligned.run().report().status() == AlignmentStatus.DEGRADED) {
							degraded++;
						}
					}
				}
			}
		}
		runs.markComplete(processData.md5(), Aligner.VERSION);
		return new IngestReport.TelemetryLoad(false, stored, present, degraded, failed, sampleRows);
	}

	private IngestReport.MeasurementLoad loadMeasurements(DataFiles.VerifiedFile csv, MeasurementSet set) {
		if (runs.ledger(csv.md5(), NO_ALIGNER) == RunStore.LedgerStatus.COMPLETE) {
			return IngestReport.MeasurementLoad.alreadyIngested(set);
		}
		runs.markStarted(csv.md5(), NO_ALIGNER, csv.path().getFileName().toString(), csv.bytes());
		MeasurementCsv.Parsed parsed = MeasurementCsv.read(csv, set);
		Map<String, RunId> runIds = runs.publicRunsByExperimentKey();
		Map<String, List<MeasurementRecord>> byWafer = parsed.records()
			.stream()
			.collect(Collectors.groupingBy(MeasurementRecord::experimentKey, LinkedHashMap::new, Collectors.toList()));
		int stored = 0;
		int present = 0;
		int withoutRun = 0;
		for (Map.Entry<String, List<MeasurementRecord>> wafer : byWafer.entrySet()) {
			RunId run = runIds.get(wafer.getKey());
			if (run == null) {
				withoutRun += wafer.getValue().size();
				continue;
			}
			int inserted = measurements.insert(run, set, wafer.getValue());
			stored += inserted;
			present += wafer.getValue().size() - inserted;
		}
		runs.markComplete(csv.md5(), NO_ALIGNER);
		return new IngestReport.MeasurementLoad(set, false, stored, present, parsed.skippedBlankKey(), withoutRun);
	}

}
