package io.github.bryancruzcb.chamberwatch.depth;

import java.util.ArrayList;
import java.util.List;
import java.util.OptionalDouble;
import java.util.SplittableRandom;
import java.util.function.IntFunction;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

class DepthModelTest {

	private static final List<String> NAMES = List.of("Carrier/SF6/mean", "Noise/SF6/mean", "Flat/SF6/mean");

	@Test
	void noLotTakesPartInItsOwnPrediction() {
		DepthData data = lots(5, 10, (lot) -> 0.0);
		DepthReport report = DepthModel.evaluate(data, DepthModel.LAMBDAS).orElseThrow();

		for (int lot = 1; lot <= 5; lot++) {
			int changedLot = lot;
			DepthData changed = new DepthData(NAMES, data.samples()
				.stream()
				.map((s) -> (s.lotNo() != changedLot) ? s : new DepthSample(s.runId(), s.lotNo(), s.position(),
						s.features(), OptionalDouble.of(s.measuredUm().orElseThrow() + 25)))
				.toList());

			List<DepthReport.Prediction> before = predictionsOf(report, lot);
			List<DepthReport.Prediction> after = predictionsOf(DepthModel.evaluate(changed, DepthModel.LAMBDAS).orElseThrow(), lot);
			for (int i = 0; i < before.size(); i++) {
				assertThat(after.get(i).predictedUm()).as("lot %d", lot).isEqualTo(before.get(i).predictedUm());
			}
		}
	}

	@Test
	void theTelemetryModelFindsTheFeatureThatCarriesDepthAndBeatsBothBaselines() {
		DepthReport report = DepthModel.evaluate(lots(6, 10, (lot) -> 0.2 * lot), DepthModel.LAMBDAS).orElseThrow();

		DepthReport.MethodErrors telemetry = report.methods().get(0);
		DepthReport.MethodErrors position = report.methods().get(1);
		DepthReport.MethodErrors firstWafers = report.methods().get(2);
		assertThat(telemetry.method()).isEqualTo(DepthReport.Method.TELEMETRY);
		assertThat(telemetry.all().orElseThrow().rmseUm()).isLessThan(position.all().orElseThrow().rmseUm());
		assertThat(telemetry.late().rmseUm()).isLessThan(firstWafers.late().rmseUm());
		assertThat(report.strongest().get(0).feature()).isEqualTo("Carrier/SF6/mean");
		assertThat(report.strongest()).extracting(DepthReport.Coefficient::feature).doesNotContain("Flat/SF6/mean");
		assertThat(report.wafers()).isEqualTo(60);
		assertThat(report.lots()).isEqualTo(6);
		assertThat(report.features()).isEqualTo(3);
	}

	@Test
	void thePositionLineIsExactWhenDepthIsAStraightLineInPosition() {
		List<DepthSample> samples = new ArrayList<>();
		int run = 1;
		for (int lot = 1; lot <= 4; lot++) {
			for (int position = 1; position <= 10; position++) {
				samples.add(new DepthSample(run++, lot, position, new double[] { lot, position * position, 1 },
						OptionalDouble.of(44 - 0.1 * position)));
			}
		}

		DepthReport report = DepthModel.evaluate(new DepthData(NAMES, samples), DepthModel.LAMBDAS).orElseThrow();

		assertThat(report.methods().get(1).all().orElseThrow().rmseUm()).isCloseTo(0, within(1e-9));
	}

	@Test
	void theFirstWafersBaselineScoresOnlyTheWafersAfterThemAndUnmeasuredWafersArePredictedButNotScored() {
		List<DepthSample> samples = new ArrayList<>(lots(4, 10, (lot) -> 0.0).samples());
		samples.add(new DepthSample(999, 2, 11, new double[] { 1, 0, 1 }, OptionalDouble.empty()));

		DepthReport report = DepthModel.evaluate(new DepthData(NAMES, samples), DepthModel.LAMBDAS).orElseThrow();

		DepthReport.MethodErrors firstWafers = report.methods().get(2);
		assertThat(firstWafers.all()).isEmpty();
		assertThat(firstWafers.late().wafers()).isEqualTo(4 * 7);
		assertThat(report.methods().get(0).late().wafers()).isEqualTo(4 * 7);
		assertThat(report.wafers()).isEqualTo(40);
		assertThat(report.predictions()).hasSize(41);
		DepthReport.Prediction unmeasured = report.predictions()
			.stream()
			.filter((p) -> p.runId() == 999)
			.findFirst()
			.orElseThrow();
		assertThat(unmeasured.measuredUm()).isEmpty();
		assertThat(unmeasured.lotRmseUm()).isPresent();
		assertThat(report.byPosition()).extracting(DepthReport.PositionDepth::position).containsExactly(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
	}

	@Test
	void twoLotsAreNotEnoughAndSayNoModelRatherThanThrow() {
		assertThat(DepthModel.evaluate(lots(2, 10, (lot) -> 0.0), DepthModel.LAMBDAS)).isEmpty();
		assertThat(DepthModel.evaluate(lots(3, 10, (lot) -> 0.0), DepthModel.LAMBDAS)).isPresent();
	}

	/**
	 * Lots of wafers whose depth falls along the lot and moves with the carrier feature, plus a lot offset; the
	 * noise feature is unrelated, and the flat one never varies.
	 */
	private static DepthData lots(int lots, int wafers, IntFunction<Double> offset) {
		SplittableRandom random = new SplittableRandom(7);
		List<DepthSample> samples = new ArrayList<>();
		int run = 1;
		for (int lot = 1; lot <= lots; lot++) {
			for (int position = 1; position <= wafers; position++) {
				double carrier = position * 0.8 + random.nextGaussian(0, 0.5);
				double depth = 44 - 0.3 * carrier + offset.apply(lot) + random.nextGaussian(0, 0.02);
				samples.add(new DepthSample(run++, lot, position,
						new double[] { carrier, random.nextGaussian(), 3.0 }, OptionalDouble.of(depth)));
			}
		}
		return new DepthData(NAMES, samples);
	}

	private static List<DepthReport.Prediction> predictionsOf(DepthReport report, int lot) {
		return report.predictions().stream().filter((p) -> p.lotNo() == lot).toList();
	}

}
