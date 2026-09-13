package io.github.bryancruzcb.chamberwatch.ingest;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;

import io.github.bryancruzcb.chamberwatch.store.MeasurementRecord;
import io.github.bryancruzcb.chamberwatch.store.MeasurementSet;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalStateException;

class MeasurementCsvTest {

	@TempDir
	Path dir;

	@Test
	void theNinePointFileNumbersPointsPerWaferAndSkipsRowsWithoutAKey() throws Exception {
		DataFiles.VerifiedFile csv = verified("nine.csv", """
				experiment_key,lot_number,wafer_number,loc_id,X,Y,preox_thickness,postox_thickness,stepheight,oxide_etch,si_etch
				2024-07-02_01,1,1,F10,0,-76000,1.0034,0.4474,40.907,0.556,40.351
				2024-07-02_01,1,1,D8,-38000,-38000,0.9993,0.363,40.008,0.6363,39.3717
				2024-07-02_02,1,2,F10,0,-76000,1.0,0.45,41.0,0.55,40.45
				,,,F10,0,-76000,1.0031,0.4534,40.8461,0.5497,40.2964
				""");

		MeasurementCsv.Parsed parsed = MeasurementCsv.read(csv, MeasurementSet.NINE_POINT);

		assertThat(parsed.skippedBlankKey()).isEqualTo(1);
		assertThat(parsed.records()).containsExactly(
				new MeasurementRecord("2024-07-02_01", 1, Optional.of("F10"), 0, -76000, 1.0034, 0.4474, true, 40.907, 0.556, 40.351),
				new MeasurementRecord("2024-07-02_01", 2, Optional.of("D8"), -38000, -38000, 0.9993, 0.363, true, 40.008, 0.6363, 39.3717),
				new MeasurementRecord("2024-07-02_02", 1, Optional.of("F10"), 0, -76000, 1.0, 0.45, true, 41.0, 0.55, 40.45));
	}

	@Test
	void theEightyNinePointFileMarksInterpolatedOxideReadings() throws Exception {
		DataFiles.VerifiedFile csv = verified("eighty-nine.csv", """
				experiment_key,lot_number,wafer_number,X,Y,preox_thickness,postox_thickness,postox_thickness_nan,stepheight,oxide_etch,si_etch
				2024-07-02_01,1,1,-19000,-95000,1.002226171,0.5259,0.5259,52.989,0.476326171,52.4631
				2024-07-02_01,1,1,0,-95000,1.002,0.51,N/A,52.0,0.49,51.49
				2024-07-02_01,1,1,19000,-95000,1.002,0.52,,52.1,0.48,51.58
				""");

		List<MeasurementRecord> records = MeasurementCsv.read(csv, MeasurementSet.EIGHTY_NINE_POINT).records();

		assertThat(records).extracting(MeasurementRecord::postoxMeasured).containsExactly(true, false, false);
		assertThat(records).extracting(MeasurementRecord::locId).containsOnly(Optional.empty());
		assertThat(records).extracting(MeasurementRecord::pointNo).containsExactly(1, 2, 3);
	}

	@Test
	void aBlankRequiredNumberNamesItsLine() throws Exception {
		DataFiles.VerifiedFile csv = verified("broken.csv", """
				experiment_key,lot_number,wafer_number,loc_id,X,Y,preox_thickness,postox_thickness,stepheight,oxide_etch,si_etch
				2024-07-02_01,1,1,F10,0,-76000,1.0034,0.4474,,0.556,40.351
				""");

		assertThatIllegalStateException().isThrownBy(() -> MeasurementCsv.read(csv, MeasurementSet.NINE_POINT))
			.withMessageContaining("line 2")
			.withMessageContaining("stepheight");
	}

	private DataFiles.VerifiedFile verified(String name, String content) throws IOException, NoSuchAlgorithmException {
		Path file = dir.resolve(name);
		Files.writeString(file, content);
		String md5 = HexFormat.of().formatHex(MessageDigest.getInstance("MD5").digest(Files.readAllBytes(file)));
		Files.writeString(dir.resolve(name + ".md5"), md5 + "  " + name + "\n");
		return DataFiles.verify(dir, dir.resolve(name + ".md5"), List.of(name)).get(name);
	}

}
