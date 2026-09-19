package io.github.bryancruzcb.chamberwatch.api;

import java.time.LocalDate;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

import io.github.bryancruzcb.chamberwatch.TestcontainersConfiguration;
import io.github.bryancruzcb.chamberwatch.recipe.Aligner;
import io.github.bryancruzcb.chamberwatch.recipe.EtchRuns;
import io.github.bryancruzcb.chamberwatch.recipe.RawRun;
import io.github.bryancruzcb.chamberwatch.recipe.RunKey;
import io.github.bryancruzcb.chamberwatch.recipe.Source;
import io.github.bryancruzcb.chamberwatch.store.LotRecord;
import io.github.bryancruzcb.chamberwatch.store.LotRef;
import io.github.bryancruzcb.chamberwatch.store.MeasurementRecord;
import io.github.bryancruzcb.chamberwatch.store.MeasurementSet;
import io.github.bryancruzcb.chamberwatch.store.MeasurementStore;
import io.github.bryancruzcb.chamberwatch.store.RunId;
import io.github.bryancruzcb.chamberwatch.store.RunStore;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;
import org.springframework.test.web.servlet.assertj.MockMvcTester;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

/**
 * The depth endpoints over three public lots of four measured wafers. Other tests store public lots in the same
 * database, so the checks here hold whatever else is there: the shape of the report, and this test's own wafers.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class DepthApiTest {

	private static final int FIRST_LOT = 960;

	@Autowired
	private MockMvcTester mvc;

	@Autowired
	private RunStore runs;

	@Autowired
	private MeasurementStore measurements;

	private int measuredRun;

	private int unmeasuredRun;

	private int simulatedRun;

	@BeforeAll
	void storeThreeMeasuredLots() {
		for (int lot = FIRST_LOT; lot < FIRST_LOT + 3; lot++) {
			LocalDate day = LocalDate.of(2032, 1, lot - FIRST_LOT + 1);
			LotRef ref = runs.upsertLot(new LotRecord(Source.PUBLIC, lot, Optional.of(day), Optional.empty()));
			for (int position = 1; position <= 5; position++) {
				String group = String.format(Locale.ROOT, "Day_%d_%02d_%02d_Wafer_%02d", day.getYear(), day.getMonthValue(),
						day.getDayOfMonth(), position);
				RawRun raw = EtchRuns.etch().key(RunKey.ofPublicGroup(group)).build().run();
				int id = runs.insertIfAbsent(raw, Aligner.STANDARD.align(raw), ref, Optional.empty()).orElseThrow().value();
				if (position == 5) {
					unmeasuredRun = (lot == FIRST_LOT) ? id : unmeasuredRun;
					continue;
				}
				String experiment = String.format(Locale.ROOT, "%s_%02d", day, position);
				// depth is the step height less the oxide left: 40.0 + position / 10
				measurements.insert(new RunId(id), MeasurementSet.EIGHTY_NINE_POINT, List.of(new MeasurementRecord(experiment,
						1, Optional.empty(), 0, 0, 1.0, 0.5, true, 40.5 + position / 10.0, 0.5, 40.0)));
				measuredRun = (lot == FIRST_LOT && position == 2) ? id : measuredRun;
			}
		}
		LotRef simulated = runs.upsertLot(new LotRecord(Source.SYNTHETIC, 963, Optional.empty(), Optional.empty()));
		RawRun raw = EtchRuns.etch().key(RunKey.simulated(5, 963, 1)).build().run();
		simulatedRun = runs.insertIfAbsent(raw, Aligner.STANDARD.align(raw), simulated, Optional.empty()).orElseThrow().value();
	}

	@Test
	void theReportScoresTheModelAndBothBaselinesOnTheMeasuredWafers() {
		var body = assertThat(mvc.get().uri("/api/reports/depth-model")).hasStatusOk().bodyJson();

		body.extractingPath("$.set").isEqualTo("EIGHTY_NINE_POINT");
		body.extractingPath("$.wafers").asNumber().satisfies((n) -> assertThat(n.intValue()).isGreaterThanOrEqualTo(12));
		body.extractingPath("$.methods[*].method").asArray().containsExactly("TELEMETRY", "POSITION", "FIRST_WAFERS");
		body.extractingPath("$.methods[2].all").isNull();
		body.extractingPath("$.methods[2].late.wafers").asNumber().satisfies((n) -> assertThat(n.intValue()).isPositive());
		body.extractingPath("$.byPosition[0].position").isEqualTo(1);
	}

	@Test
	void aMeasuredWaferComesWithItsPredictionItsDepthAndItsLotsError() {
		var body = assertThat(mvc.get().uri("/api/runs/{id}/depth", measuredRun)).hasStatusOk().bodyJson();

		body.extractingPath("$.lotNo").isEqualTo(FIRST_LOT);
		body.extractingPath("$.measuredUm").asNumber().satisfies((depth) -> assertThat(depth.doubleValue()).isCloseTo(40.2, within(1e-4)));
		body.extractingPath("$.predictedUm").asNumber().satisfies((depth) -> assertThat(depth.doubleValue()).isBetween(39.0, 42.0));
		body.extractingPath("$.residualUm").asNumber().isNotNull();
		body.extractingPath("$.lotRmseUm").asNumber().isNotNull();
	}

	@Test
	void anUnmeasuredWaferIsPredictedWithoutADepthAndSimulatedOrUnknownRunsAreNotFound() {
		var unmeasured = assertThat(mvc.get().uri("/api/runs/{id}/depth", unmeasuredRun)).hasStatusOk().bodyJson();
		unmeasured.extractingPath("$.measuredUm").isNull();
		unmeasured.extractingPath("$.residualUm").isNull();
		unmeasured.extractingPath("$.predictedUm").asNumber().isNotNull();

		assertThat(mvc.get().uri("/api/runs/{id}/depth", simulatedRun)).hasStatus(HttpStatus.NOT_FOUND)
			.bodyJson()
			.extractingPath("$.detail")
			.asString()
			.contains("public wafers only");
		assertThat(mvc.get().uri("/api/runs/{id}/depth", 987_654)).hasStatus(HttpStatus.NOT_FOUND);
	}

	@Test
	void theOpenApiDescriptionListsTheDepthEndpoints() {
		assertThat(mvc.get().uri("/v3/api-docs")).hasStatusOk()
			.bodyJson()
			.extractingPath("$.paths")
			.asMap()
			.containsKeys("/api/runs/{runId}/depth", "/api/reports/depth-model");
	}

}
