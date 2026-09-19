package io.github.bryancruzcb.chamberwatch.ingest;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.OptionalDouble;

import io.github.bryancruzcb.chamberwatch.depth.DepthData;
import io.github.bryancruzcb.chamberwatch.depth.DepthModel;
import io.github.bryancruzcb.chamberwatch.depth.DepthReport;
import io.github.bryancruzcb.chamberwatch.recipe.AlignedRun;
import io.github.bryancruzcb.chamberwatch.recipe.Aligner;
import io.github.bryancruzcb.chamberwatch.recipe.RunKey;
import io.github.bryancruzcb.chamberwatch.store.LotRecord;
import io.github.bryancruzcb.chamberwatch.store.MeasurementRecord;
import io.github.bryancruzcb.chamberwatch.store.MeasurementSet;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

/**
 * The depth model on the public wafers, straight from the files: phase summaries from the aligner, depth from the
 * measurement files, lots from the lot sheet. The numbers pinned here are the ones docs/DEPTH.md reports. The
 * dataset is not in the repository, so this runs only where it has been downloaded, and CI skips it.
 */
@EnabledIf("publicDataPresent")
class PublicDataDepthTest {

	private static final Path DATA = Path.of("../data/public/zenodo17122442");

	private static final Path MD5_LIST = Path.of("../docs/zenodo17122442.md5");

	static boolean publicDataPresent() {
		return Files.exists(DATA.resolve(AlignCommand.PROCESS_DATA));
	}

	@Test
	void telemetryPredictsTheEightyNinePointDepthBetterThanPositionOrTheFirstWafers() {
		DepthReport report = DepthModel.evaluate(publicData(MeasurementSet.EIGHTY_NINE_POINT), DepthModel.LAMBDAS).orElseThrow();

		assertThat(report.wafers()).isEqualTo(88);
		assertThat(report.lots()).isEqualTo(10);
		assertThat(report.features()).isEqualTo(124);
		assertThat(report.methods().get(0).all().orElseThrow().rmseUm()).isCloseTo(0.1624, within(0.0001));
		assertThat(report.methods().get(1).all().orElseThrow().rmseUm()).isCloseTo(0.2209, within(0.0001));
		assertThat(report.methods().get(0).late().rmseUm()).isCloseTo(0.1555, within(0.0001));
		assertThat(report.methods().get(1).late().rmseUm()).isCloseTo(0.2100, within(0.0001));
		assertThat(report.methods().get(2).late().rmseUm()).isCloseTo(0.7078, within(0.0001));
		assertThat(report.methods().get(2).late().wafers()).isEqualTo(58);
		assertThat(report.lambda()).isEqualTo(10.0);
		assertThat(report.predictions()).hasSize(96);
	}

	@Test
	void theNinePointSetTellsTheSameStory() {
		DepthReport report = DepthModel.evaluate(publicData(MeasurementSet.NINE_POINT), DepthModel.LAMBDAS).orElseThrow();

		assertThat(report.wafers()).isEqualTo(75);
		assertThat(report.methods().get(0).all().orElseThrow().rmseUm()).isCloseTo(0.1506, within(0.0001));
		assertThat(report.methods().get(1).all().orElseThrow().rmseUm()).isCloseTo(0.1945, within(0.0001));
		assertThat(report.methods().get(2).late().rmseUm()).isCloseTo(0.6709, within(0.0001));
	}

	private static DepthData publicData(MeasurementSet set) {
		Map<String, DataFiles.VerifiedFile> files = DataFiles.verify(DATA, MD5_LIST, IngestService.PUBLIC_FILES);
		Map<LocalDate, Integer> lotByDay = new HashMap<>();
		for (LotRecord lot : LotSheet.read(files.get(IngestService.LOT_STATUS))) {
			lotByDay.put(lot.runDate().orElseThrow(), lot.lotNo());
		}
		String file = (set == MeasurementSet.NINE_POINT) ? IngestService.NINE_POINT_CSV : IngestService.EIGHTY_NINE_POINT_CSV;
		Map<String, List<Double>> depthsByExperiment = new HashMap<>();
		for (MeasurementRecord point : MeasurementCsv.read(files.get(file), set).records()) {
			depthsByExperiment.computeIfAbsent(point.experimentKey(), (key) -> new ArrayList<>())
				.add(point.stepheightUm() - point.postoxUm());
		}
		List<DepthData.Wafer> wafers = new ArrayList<>();
		try (NetcdfTelemetrySource source = NetcdfTelemetrySource.open(files.get(AlignCommand.PROCESS_DATA),
				files.get(AlignCommand.DICTIONARY))) {
			int runId = 1;
			for (RunKey key : source.keys()) {
				AlignedRun run = Aligner.STANDARD.align(source.read(key)).orElseThrow();
				List<Double> depths = depthsByExperiment.get(key.experimentKey().orElseThrow());
				OptionalDouble measured = (depths == null) ? OptionalDouble.empty()
						: OptionalDouble.of(depths.stream().mapToDouble(Double::doubleValue).average().orElseThrow());
				wafers.add(new DepthData.Wafer(runId++, lotByDay.get(key.day().orElseThrow()), key.positionInLot(),
						run.summaries(), measured));
			}
		}
		return DepthData.of(wafers);
	}

}
