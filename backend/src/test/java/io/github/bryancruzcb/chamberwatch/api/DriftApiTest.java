package io.github.bryancruzcb.chamberwatch.api;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import com.jayway.jsonpath.JsonPath;
import io.github.bryancruzcb.chamberwatch.TestcontainersConfiguration;
import io.github.bryancruzcb.chamberwatch.detect.DetectorConfig;
import io.github.bryancruzcb.chamberwatch.detect.HealthModel;
import io.github.bryancruzcb.chamberwatch.detect.LotFit;
import io.github.bryancruzcb.chamberwatch.detect.SummaryBand;
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
import org.springframework.test.web.servlet.assertj.MockMvcTester;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;
import static org.assertj.core.api.Assertions.withinPercentage;

/**
 * The lot page and the drift report over a synthetic lot of eight wafers whose SF6 pressure rises with position,
 * scattered a little so every fit has residuals, and whose measured depth falls 0.2 µm per wafer.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class DriftApiTest {

	private static final int LOT_NO = 960;

	/** Added to the SF6 pressure of wafers 1 to 8: 0.002 per wafer, give or take up to 0.0004. */
	private static final float[] PRESSURE_RISE = { 0.0020f, 0.0043f, 0.0058f, 0.0084f, 0.0097f, 0.0121f, 0.0136f,
			0.0162f };

	private static final DetectorConfig.DriftRule RULE = DetectorConfig.defaults().drift();

	@Autowired
	private MockMvcTester mvc;

	@Autowired
	private RunStore runs;

	@Autowired
	private MeasurementStore measurements;

	@Autowired
	private HealthService health;

	private int lotId;

	@BeforeAll
	void storeARisingLot() {
		LotRef lot = runs.upsertLot(new LotRecord(Source.SYNTHETIC, LOT_NO, Optional.empty(), Optional.empty()));
		lotId = lot.id();
		for (int position = 1; position <= PRESSURE_RISE.length; position++) {
			RawRun raw = EtchRuns.etch()
				.key(RunKey.simulated(3, LOT_NO, position))
				.pressureOffsetFrom(1, PRESSURE_RISE[position - 1])
				.build()
				.run();
			RunId run = runs.insertIfAbsent(raw, Aligner.STANDARD.align(raw), lot, Optional.empty()).orElseThrow();
			double depth = 44 - 0.2 * position;
			measurements.insert(run, MeasurementSet.EIGHTY_NINE_POINT, List
				.of(new MeasurementRecord("SIM", 1, Optional.empty(), 0, 0, 1.0, 0.5, true, depth + 0.5, 0.5, depth)));
		}
		health.refresh(Source.SYNTHETIC);
	}

	@Test
	void theRisingPressureIsProjectedToLeaveTheBandAndThenIsOutOfIt() {
		var body = assertThat(mvc.get().uri("/api/lots/{id}/drift", lotId)).hasStatusOk().bodyJson();

		body.extractingPath("$.phase").isEqualTo("SF6");
		body.extractingPath("$.channels[0].channel").isEqualTo("Pressure");
		body.extractingPath("$.channels[0].state").isEqualTo("OUT_OF_BAND");
		body.extractingPath("$.channels[0].points[*].state")
			.asArray()
			.startsWith("INSUFFICIENT_RUNS", "INSUFFICIENT_RUNS", "INSUFFICIENT_RUNS", "WILL_EXIT");
	}

	@Test
	void theFitsPostgresComputesAreTheFitsOfTheWafersSoFar() throws Exception {
		String json = mvc.get().uri("/api/lots/{id}/drift", lotId).exchange().getResponse().getContentAsString();
		String pressure = "$.channels[?(@.channel == 'Pressure')]";
		List<Map<String, Object>> points = JsonPath.read(json, pressure + ".points[*]");
		SummaryBand band = new SummaryBand(first(json, pressure + ".bandMean"), first(json, pressure + ".bandSd"));

		List<LotFit.Point> wafersSoFar = new ArrayList<>();
		for (Map<String, Object> point : points) {
			wafersSoFar.add(new LotFit.Point((Integer) point.get("position"), number(point.get("value"))));
			if (wafersSoFar.size() == 1) {
				assertThat(point.get("slope")).isNull();
				continue;
			}
			LotFit fit = LotFit.of(wafersSoFar);
			assertThat(number(point.get("slope"))).isCloseTo(fit.slope(), withinPercentage(1e-7));
			assertThat(number(point.get("intercept"))).isCloseTo(fit.intercept(), withinPercentage(1e-7));
			if (wafersSoFar.size() >= 3) {
				assertThat(number(point.get("tStat"))).isCloseTo(fit.tStat(), withinPercentage(1e-5));
			}
			assertThat(point.get("state")).isEqualTo(HealthModel.project(fit, band, RULE).state().name());
		}
		assertThat(wafersSoFar).hasSize(PRESSURE_RISE.length);
	}

	@Test
	void theReportPutsDriftScoresNextToDepthLossByPosition() {
		var body = assertThat(mvc.get().uri("/api/reports/drift-vs-depth?source=SYNTHETIC")).hasStatusOk().bodyJson();

		body.extractingPath("$.referenceWafers").isEqualTo(3);
		body.extractingPath("$.positions[*].position").asArray().containsExactly(1, 2, 3, 4, 5, 6, 7, 8);
		body.extractingPath("$.positions[7].depth[0].set").isEqualTo("EIGHTY_NINE_POINT");
		body.extractingPath("$.positions[7].depth[0].meanDepthLossUm")
			.asNumber()
			.satisfies((loss) -> assertThat(loss.doubleValue()).isCloseTo(1.2, within(1e-4)));
		body.extractingPath("$.positions[*].meanDriftScore").asArray().satisfies((scores) -> {
			double[] score = Arrays.stream(scores).mapToDouble(DriftApiTest::number).toArray();
			assertThat(score[7]).isGreaterThan(score[3]);
			assertThat(score[3]).isGreaterThan(Math.max(score[0], Math.max(score[1], score[2])));
		});
	}

	@Test
	void theLotReferenceCentersTheBandOnTheLotsOwnFirstWafers() throws Exception {
		String global = mvc.get().uri("/api/lots/{id}/drift", lotId).exchange().getResponse().getContentAsString();
		String own = mvc.get().uri("/api/lots/{id}/drift?reference=LOT", lotId).exchange().getResponse().getContentAsString();
		String pressure = "$.channels[?(@.channel == 'Pressure')]";

		assertThat((String) JsonPath.read(global, "$.reference")).isEqualTo("GLOBAL");
		assertThat((String) JsonPath.read(own, "$.reference")).isEqualTo("LOT");
		assertThat((Integer) JsonPath.read(own, "$.referenceWafers")).isEqualTo(3);
		List<Map<String, Object>> points = JsonPath.read(own, pressure + ".points[*]");
		double sd = first(own, pressure + ".bandSd");
		double start = points.subList(0, 3).stream().mapToDouble((point) -> number(point.get("value"))).average().orElseThrow();
		assertThat(first(own, pressure + ".bandMean")).isCloseTo(start, withinPercentage(1e-9));
		assertThat(sd).isEqualTo(first(global, pressure + ".bandSd"));
		assertThat(number(points.get(0).get("z"))).isCloseTo((number(points.get(0).get("value")) - start) / sd, within(1e-9));
		// the pressure rises 0.014 over the lot, many spreads, so the lot leaves its own start as well
		assertThat(JsonPath.<List<String>>read(own, pressure + ".state")).containsExactly("OUT_OF_BAND");
		assertThat(JsonPath.<List<String>>read(global, pressure + ".state")).containsExactly("OUT_OF_BAND");
	}

	@Test
	void anUnknownLotPhaseOrReferenceIsAClientError() {
		assertThat(mvc.get().uri("/api/lots/{id}/drift", 32_000)).hasStatus(HttpStatus.NOT_FOUND);
		assertThat(mvc.get().uri("/api/lots/{id}/drift?phase=ARGON", lotId)).hasStatus(HttpStatus.BAD_REQUEST);
		assertThat(mvc.get().uri("/api/lots/{id}/drift?reference=TOOL", lotId)).hasStatus(HttpStatus.BAD_REQUEST);
	}

	private static double first(String json, String path) {
		List<Object> values = JsonPath.read(json, path);
		return number(values.get(0));
	}

	private static double number(Object value) {
		return ((Number) value).doubleValue();
	}

}
