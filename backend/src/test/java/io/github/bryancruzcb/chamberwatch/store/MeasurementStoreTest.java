package io.github.bryancruzcb.chamberwatch.store;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

import io.github.bryancruzcb.chamberwatch.TestcontainersConfiguration;
import io.github.bryancruzcb.chamberwatch.recipe.Aligner;
import io.github.bryancruzcb.chamberwatch.recipe.EtchRuns;
import io.github.bryancruzcb.chamberwatch.recipe.RawRun;
import io.github.bryancruzcb.chamberwatch.recipe.RunKey;
import io.github.bryancruzcb.chamberwatch.recipe.Source;
import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

@SpringBootTest
@Import(TestcontainersConfiguration.class)
class MeasurementStoreTest {

	@Autowired
	private RunStore runs;

	@Autowired
	private MeasurementStore measurements;

	@Autowired
	private JdbcClient jdbc;

	@Test
	void measurementsLoadOnceAndDepthComesFromStepHeightMinusRemainingOxide() {
		LotRef lot = runs.upsertLot(new LotRecord(Source.PUBLIC, 1, Optional.of(LocalDate.of(2024, 7, 2)),
				Optional.of(new LotRecord.Conditioning(3, LotRecord.Surface.CHUCK))));
		RawRun raw = EtchRuns.etch().key(RunKey.ofPublicGroup("Day_2024_07_02_Wafer_01")).build().run();
		runs.insertIfAbsent(raw, Aligner.STANDARD.align(raw), lot, Optional.empty());
		RunId run = runs.publicRunsByExperimentKey().get("2024-07-02_01");
		List<MeasurementRecord> rows = List.of(
				new MeasurementRecord("2024-07-02_01", 1, Optional.of("F10"), 0, -76000, 1.0034, 0.4474, true, 40.907, 0.556, 40.351),
				new MeasurementRecord("2024-07-02_01", 2, Optional.of("D8"), -38000, -38000, 0.9993, 0.363, true, 40.008, 0.6363, 39.3717));

		int first = measurements.insert(run, MeasurementSet.NINE_POINT, rows);
		int second = measurements.insert(run, MeasurementSet.NINE_POINT, rows);

		assertThat(run).isNotNull();
		assertThat(first).isEqualTo(2);
		assertThat(second).isZero();
		Double depth = jdbc.sql("select depth_um from measurement where run_id = ? and measurement_set = 'NINE_POINT' and point_no = 1")
			.param(run.value())
			.query(Double.class)
			.single();
		assertThat(depth).isCloseTo(40.907 - 0.4474, within(1e-4));
	}

}
