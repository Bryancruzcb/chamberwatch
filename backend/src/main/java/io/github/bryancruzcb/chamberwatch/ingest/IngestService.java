package io.github.bryancruzcb.chamberwatch.ingest;

import java.nio.file.Path;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import io.github.bryancruzcb.chamberwatch.recipe.Aligner;
import io.github.bryancruzcb.chamberwatch.recipe.AlignmentResult;
import io.github.bryancruzcb.chamberwatch.recipe.AlignmentStatus;
import io.github.bryancruzcb.chamberwatch.recipe.RawRun;
import io.github.bryancruzcb.chamberwatch.recipe.RunKey;
import io.github.bryancruzcb.chamberwatch.store.LotRecord;
import io.github.bryancruzcb.chamberwatch.store.LotRef;
import io.github.bryancruzcb.chamberwatch.store.RunStore;

import org.springframework.stereotype.Service;

/**
 * Loads the public files into PostgreSQL. Safe to rerun at any point: one transaction per wafer, and a
 * wafer whose run key is stored is skipped without being decoded, so a rerun resumes and adds nothing.
 */
@Service
public class IngestService {

	static final String LOT_STATUS = "Lot_status.xlsx";

	private final RunStore runs;

	public IngestService(RunStore runs) {
		this.runs = runs;
	}

	public IngestReport ingestPublic(Path dataDir, Path md5List) {
		Map<String, DataFiles.VerifiedFile> files = DataFiles.verify(dataDir, md5List,
				List.of(AlignCommand.PROCESS_DATA, AlignCommand.DICTIONARY, LOT_STATUS));
		for (LotRecord lot : LotSheet.read(files.get(LOT_STATUS))) {
			runs.upsertLot(lot);
		}
		Map<LocalDate, LotRef> lotsByDay = runs.publicLotsByDay();
		DataFiles.VerifiedFile processData = files.get(AlignCommand.PROCESS_DATA);
		if (runs.ledger(processData.md5(), Aligner.VERSION) == RunStore.LedgerStatus.COMPLETE) {
			return IngestReport.skipped();
		}
		runs.markStarted(processData.md5(), Aligner.VERSION, AlignCommand.PROCESS_DATA, processData.bytes());
		int stored = 0;
		int present = 0;
		int degraded = 0;
		int failed = 0;
		long sampleRows = 0;
		try (NetcdfTelemetrySource source = NetcdfTelemetrySource.open(processData, files.get(AlignCommand.DICTIONARY))) {
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
		return new IngestReport(false, stored, present, degraded, failed, sampleRows);
	}

}
