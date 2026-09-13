package io.github.bryancruzcb.chamberwatch.detect;

import java.util.List;
import java.util.stream.IntStream;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

class DriftTest {

	private final DetectorConfig.DriftRule rule = DetectorConfig.DriftRule.DEFAULT;

	/** Mean 12, sd 1: with k = 3 the band runs from 9 to 15. */
	private final SummaryBand band = new SummaryBand(12, 1);

	@Test
	void anExactLineHasItsSlopeInterceptAndAnInfiniteT() {
		LotFit fit = LotFit.of(line(4, 10, 1));

		assertThat(fit.slope()).isCloseTo(1, within(1e-12));
		assertThat(fit.intercept()).isCloseTo(10, within(1e-12));
		assertThat(fit.tStat()).isInfinite().isPositive();
		assertThat(fit.asOfPosition()).isEqualTo(4);
	}

	@Test
	void aRisingLotIsProjectedToLeaveTheBand() {
		// fitted value at wafer 4 is 14, and the line crosses 15 at wafer 5, so wafer 6 is the first outside
		DriftProjection projection = HealthModel.project(LotFit.of(line(4, 10, 1)), band, rule);

		assertThat(projection.state()).isEqualTo(DriftProjection.State.WILL_EXIT);
		assertThat(projection.firstOutPosition()).hasValue(6);
		assertThat(projection.runsRemaining()).hasValue(1);
	}

	@Test
	void aLotAlreadyOutsideTheBandSaysSo() {
		DriftProjection projection = HealthModel.project(LotFit.of(line(6, 10, 1)), band, rule);

		assertThat(projection.state()).isEqualTo(DriftProjection.State.OUT_OF_BAND);
		assertThat(projection.runsRemaining()).hasValue(0);
	}

	@Test
	void aSlowRiseThatStaysInsideThroughTheLotStaysIn() {
		DriftProjection projection = HealthModel.project(LotFit.of(line(5, 12, 0.1)), band, rule);

		assertThat(projection.state()).isEqualTo(DriftProjection.State.STAYS_IN);
	}

	@Test
	void noiseWithoutASlopeIsNoTrend() {
		List<LotFit.Point> points = List.of(new LotFit.Point(1, 12.3), new LotFit.Point(2, 11.6), new LotFit.Point(3, 12.4),
				new LotFit.Point(4, 11.8), new LotFit.Point(5, 12.1));

		assertThat(HealthModel.project(LotFit.of(points), band, rule).state()).isEqualTo(DriftProjection.State.NO_TREND);
	}

	@Test
	void threeWafersAreTooFewToJudge() {
		assertThat(HealthModel.project(LotFit.of(line(3, 10, 1)), band, rule).state())
			.isEqualTo(DriftProjection.State.INSUFFICIENT_RUNS);
	}

	private static List<LotFit.Point> line(int wafers, double intercept, double slope) {
		return IntStream.rangeClosed(1, wafers).mapToObj((p) -> new LotFit.Point(p, intercept + slope * p)).toList();
	}

}
