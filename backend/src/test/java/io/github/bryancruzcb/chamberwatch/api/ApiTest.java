package io.github.bryancruzcb.chamberwatch.api;

import java.time.LocalDate;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;

import io.github.bryancruzcb.chamberwatch.TestcontainersConfiguration;
import io.github.bryancruzcb.chamberwatch.health.HealthService;
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
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.assertj.MockMvcTester;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

/** The HTTP API over one public lot of five wafers, the fifth with its SF6 pressure raised from cycle 60. */
@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class ApiTest {

	private static final int LOT_NO = 950;

	@Autowired
	private MockMvcTester mvc;

	@Autowired
	private RunStore runs;

	@Autowired
	private MeasurementStore measurements;

	@Autowired
	private HealthService health;

	private int lotId;

	/** Run id by wafer position. */
	private final Map<Integer, Integer> runIds = new TreeMap<>();

	@BeforeAll
	void storeALot() {
		LotRef lot = runs.upsertLot(
				new LotRecord(Source.PUBLIC, LOT_NO, Optional.of(LocalDate.of(2031, 1, 6)), Optional.empty()));
		lotId = lot.id();
		for (int position = 1; position <= 5; position++) {
			RunKey key = RunKey.ofPublicGroup(String.format(Locale.ROOT, "Day_2031_01_06_Wafer_%02d", position));
			EtchRuns.Builder builder = EtchRuns.etch().key(key);
			if (position == 5) {
				builder.pressureOffsetFrom(60, 0.1f);
			}
			RawRun raw = builder.build().run();
			runIds.put(position, runs.insertIfAbsent(raw, Aligner.STANDARD.align(raw), lot).orElseThrow().value());
		}
		measurements.insert(new RunId(runIds.get(1)), MeasurementSet.NINE_POINT,
				List.of(new MeasurementRecord("2031-01-06_01", 1, Optional.of("B6"), 0, 19, 1.0, 0.4, true, 41.0, 0.6, 40.4),
						new MeasurementRecord("2031-01-06_01", 2, Optional.of("D4"), -19, 0, 1.0, 0.5, true, 40.5, 0.5, 40.0)));
		health.refresh(Source.PUBLIC);
	}

	@Test
	void theLotListCountsTheFlaggedWafer() {
		assertThat(mvc.get().uri("/api/lots")).hasStatusOk()
			.bodyJson()
			.extractingPath("$[?(@.source == 'PUBLIC' && @.lotNo == " + LOT_NO + ")].flaggedRuns")
			.asArray()
			.containsExactly(1);
	}

	@Test
	void theRunsTableFiltersToTheFlaggedWaferAndNamesItsFirstChannel() {
		assertThat(mvc.get().uri("/api/runs?source=PUBLIC&lot={lot}&flagged=true", lotId)).hasStatusOk()
			.bodyJson()
			.extractingPath("$.runs[*].key")
			.asArray()
			.containsExactly("Day_2031_01_06_Wafer_05");
		assertThat(mvc.get().uri("/api/runs?source=PUBLIC&lot={lot}", lotId)).bodyJson()
			.extractingPath("$.runs[?(@.positionInLot == 5)].firstChannel")
			.asArray()
			.containsExactly("Pressure");
	}

	@Test
	void aRunPageRanksThePressureFirstWithTimedExcursions() {
		var body = assertThat(mvc.get().uri("/api/runs/{id}", runIds.get(5))).hasStatusOk().bodyJson();

		body.extractingPath("$.alignment.status").isEqualTo("ALIGNED");
		body.extractingPath("$.channels[0].channel").isEqualTo("Pressure");
		body.extractingPath("$.channels[0].excursions[0].cycle").isEqualTo(60);
		body.extractingPath("$.channels[0].excursions[0].phase").isEqualTo("SF6");
		body.extractingPath("$.channels[0].excursions[0].startTimeS")
			.asNumber()
			.satisfies((time) -> assertThat(time.doubleValue()).isPositive());
		body.extractingPath("$.channels[0].phases[0].meanZ").asNumber().isNotNull();
	}

	@Test
	void aTraceKeepsTheHighestReadingWithinItsPointBudget() {
		var body = assertThat(mvc.get().uri("/api/runs/{id}/channels/Pressure/trace?maxPoints=50", runIds.get(5)))
			.hasStatusOk()
			.bodyJson();

		body.extractingPath("$.points").asArray().hasSize(50);
		body.extractingPath("$.points[*].max")
			.asArray()
			.anySatisfy((max) -> assertThat(((Number) max).doubleValue()).isCloseTo(0.14, within(1e-4)));
	}

	@Test
	void aTraceCanStayInsideACycleRangeAndCarriesTheBand() {
		var body = assertThat(
				mvc.get().uri("/api/runs/{id}/channels/Pressure/trace?fromCycle=60&toCycle=61", runIds.get(5)))
			.hasStatusOk()
			.bodyJson();

		body.extractingPath("$.points[*].cycle")
			.asArray()
			.isNotEmpty()
			.allSatisfy((cycle) -> assertThat((Integer) cycle).isBetween(60, 61));
		body.extractingPath("$.points[0].bandMean").asNumber().isNotNull();
		body.extractingPath("$.excursions").asArray().isNotEmpty();
	}

	@Test
	void measurementsComeBackWithTheirDepth() {
		var body = assertThat(mvc.get().uri("/api/runs/{id}/measurements?set=NINE_POINT", runIds.get(1)))
			.hasStatusOk()
			.bodyJson();

		body.extractingPath("$.points").isEqualTo(2);
		body.extractingPath("$.values[0].depthUm").asNumber().satisfies((depth) -> assertThat(depth.doubleValue())
			.isCloseTo(40.6, within(1e-4)));
	}

	@Test
	void relabelingRefreshesTheBaselineBeforeItAnswers() {
		assertThat(mvc.put()
			.uri("/api/runs/{id}/label", runIds.get(4))
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"label\": \"GOOD\"}")).hasStatusOk().bodyJson().extractingPath("$.current").isEqualTo(true);

		var body = assertThat(mvc.get().uri("/api/runs/{id}", runIds.get(4))).hasStatusOk().bodyJson();
		body.extractingPath("$.label").isEqualTo("GOOD");
		body.extractingPath("$.good").isEqualTo(true);
	}

	@Test
	void unknownRunsChannelsAndLabelsAreClientErrors() {
		assertThat(mvc.get().uri("/api/runs/{id}", 987_654)).hasStatus(HttpStatus.NOT_FOUND)
			.bodyJson()
			.extractingPath("$.detail")
			.isEqualTo("no run 987654");
		assertThat(mvc.get().uri("/api/runs/{id}/channels/NoSuchChannel/trace", runIds.get(1)))
			.hasStatus(HttpStatus.NOT_FOUND);
		assertThat(mvc.get().uri("/api/runs/{id}/channels/Pressure/trace?maxPoints=0", runIds.get(1)))
			.hasStatus(HttpStatus.BAD_REQUEST);
		assertThat(mvc.put()
			.uri("/api/runs/{id}/label", runIds.get(1))
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"label\": \"MAYBE\"}")).hasStatus(HttpStatus.BAD_REQUEST);
	}

	@Test
	void theOpenApiDescriptionListsTheEndpoints() {
		assertThat(mvc.get().uri("/v3/api-docs")).hasStatusOk()
			.bodyJson()
			.extractingPath("$.paths")
			.asMap()
			.containsKeys("/api/lots", "/api/runs", "/api/runs/{runId}", "/api/runs/{runId}/channels/{channel}/trace",
					"/api/runs/{runId}/measurements", "/api/runs/{runId}/label");
	}

}
