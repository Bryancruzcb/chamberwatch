package io.github.bryancruzcb.chamberwatch.ingest;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import io.github.bryancruzcb.chamberwatch.TestcontainersConfiguration;
import io.github.bryancruzcb.chamberwatch.recipe.Aligner;
import io.github.bryancruzcb.chamberwatch.store.RunStore;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * An ingest counts as done only when the ledger holds the telemetry and both measurement files as complete. The
 * checksums here are made up, so no other test's ledger rows match them.
 */
@SpringBootTest
@Import(TestcontainersConfiguration.class)
class IngestLedgerTest {

	private static final String TELEMETRY = "0123456789abcdef0123456789abcdef";

	private static final String NINE_POINT = "1123456789abcdef0123456789abcdef";

	private static final String EIGHTY_NINE_POINT = "2123456789abcdef0123456789abcdef";

	@TempDir
	private Path tmp;

	@Autowired
	private IngestService ingest;

	@Autowired
	private RunStore runs;

	@Test
	void anIngestIsDoneOnlyWhenTheTelemetryAndBothMeasurementFilesAreComplete() throws IOException {
		Path md5List = tmp.resolve("zenodo.md5");
		Files.writeString(md5List, TELEMETRY + "  " + AlignCommand.PROCESS_DATA + "\n" + NINE_POINT + "  "
				+ IngestService.NINE_POINT_CSV + "\n" + EIGHTY_NINE_POINT + "  " + IngestService.EIGHTY_NINE_POINT_CSV + "\n");

		assertThat(ingest.alreadyIngested(md5List)).isFalse();
		runs.markStarted(TELEMETRY, Aligner.VERSION, AlignCommand.PROCESS_DATA, 1);
		runs.markComplete(TELEMETRY, Aligner.VERSION);
		runs.markStarted(NINE_POINT, 0, IngestService.NINE_POINT_CSV, 1);
		runs.markComplete(NINE_POINT, 0);
		runs.markStarted(EIGHTY_NINE_POINT, 0, IngestService.EIGHTY_NINE_POINT_CSV, 1);
		// a crash in the last file leaves it started, so the ingest is not done
		assertThat(ingest.alreadyIngested(md5List)).isFalse();
		runs.markComplete(EIGHTY_NINE_POINT, 0);
		assertThat(ingest.alreadyIngested(md5List)).isTrue();
	}

}
