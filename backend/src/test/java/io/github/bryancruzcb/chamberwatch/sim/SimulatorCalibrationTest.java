package io.github.bryancruzcb.chamberwatch.sim;

import java.io.IOException;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Locale;
import java.util.Map;

import io.github.bryancruzcb.chamberwatch.detect.Baseline;
import io.github.bryancruzcb.chamberwatch.detect.ChannelBand;
import io.github.bryancruzcb.chamberwatch.detect.ChannelRole;
import io.github.bryancruzcb.chamberwatch.detect.ChannelVerdict;
import io.github.bryancruzcb.chamberwatch.detect.DetectorConfig;
import io.github.bryancruzcb.chamberwatch.detect.HealthModel;
import io.github.bryancruzcb.chamberwatch.detect.RunAssessment;
import io.github.bryancruzcb.chamberwatch.recipe.AlignedRun;
import io.github.bryancruzcb.chamberwatch.recipe.Aligner;
import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

/**
 * Checks that simulated good wafers from lots the baseline never saw alarm about as often as the public good
 * wafers did when each lot was held out of the fit, as docs/DATA.md reports. Each of four replicates fits a
 * baseline on 30 clean training runs and scores wafers 1 to 3 of 50 new lots. The public rates come from 30
 * wafers, so the tolerance allows for their sampling noise: 10 per 100 at thresholds 3 to 5, 5 above. The
 * comparison, and each channel's median band width next to the public one, go to target/sim-calibration.txt.
 */
class SimulatorCalibrationTest {

	/** Public held-out good wafers alarming, per 100, at limit thresholds k = 3 to 8. */
	private static final int[] PUBLIC_LIMIT = { 77, 33, 13, 7, 3, 3 };

	/** The same for the run-level threshold at 3 to 8. */
	private static final int[] PUBLIC_RUN_LEVEL = { 37, 10, 0, 0, 0, 0 };

	/** Median band standard deviation per channel in the baseline fitted on the public good wafers. */
	private static final Map<String, Double> PUBLIC_MEDIAN_BAND_SD = Map.ofEntries(Map.entry("ForeLinePressure", 1.154),
			Map.entry("Gas1Flow", 0.09901), Map.entry("Gas2Flow", 0.1668), Map.entry("Gas4Flow", 0.009979),
			Map.entry("Gas5Flow", 0.005202), Map.entry("Gas7Flow", 0.08243), Map.entry("Heater1Temp", 0.09998),
			Map.entry("Heater2Temp", 0.3109), Map.entry("Heater3Temp", 0.1000), Map.entry("Heater4Temp", 0.3300),
			Map.entry("HeliumBPFlow", 0.1274), Map.entry("HeliumBPPressure", 0.001516), Map.entry("PlatenDcBias", 12.57),
			Map.entry("PlatenRFLoadCapacitor", 0.5793), Map.entry("PlatenRFLoadPower", 0.5593),
			Map.entry("PlatenRFPeakToPeak", 51.00), Map.entry("PlatenRFReflectedPower", 1.475),
			Map.entry("PlatenRFTuningCapacitor", 0.1054), Map.entry("Pressure", 0.0001204),
			Map.entry("SourceRF2PeakToPeak", 0.1526), Map.entry("SourceRFLoadPower", 5.310),
			Map.entry("SourceRFPeakToPeak", 10.84), Map.entry("SourceRFReflectedPower", 3.577),
			Map.entry("moriInnerCurrent", 0.007708));

	@Test
	void simulatedGoodWafersFromUnseenLotsAlarmLikeThePublicOnes() throws IOException {
		SimulationTemplate template = SimulationTemplate.bundled();
		DetectorConfig config = DetectorConfig.defaults();
		int[] limitAlarms = new int[6];
		int[] runLevelAlarms = new int[6];
		int wafers = 0;
		Baseline firstBaseline = null;
		for (int replicate = 1; replicate <= 4; replicate++) {
			Simulator simulator = Simulator.seeded(1000 + replicate, template);
			Baseline baseline = HealthModel.fit(
					simulator.cleanTrainingRuns(30).map((r) -> Aligner.STANDARD.align(r.raw()).orElseThrow()), config);
			firstBaseline = (firstBaseline == null) ? baseline : firstBaseline;
			for (int lot = 11; lot <= 60; lot++) {
				for (int position = 1; position <= 3; position++) {
					AlignedRun run = Aligner.STANDARD.align(simulator.run(RunSpec.clean(lot, position)).raw()).orElseThrow();
					RunAssessment assessment = HealthModel.assess(run, baseline);
					double summaryZ = assessment.verdicts().stream().mapToDouble(ChannelVerdict::maxAbsSummaryZ).max().orElse(0);
					for (int threshold = 3; threshold <= 8; threshold++) {
						limitAlarms[threshold - 3] += (assessment.maxPersistentZ() > threshold) ? 1 : 0;
						runLevelAlarms[threshold - 3] += (summaryZ > threshold) ? 1 : 0;
					}
					wafers++;
				}
			}
		}
		int[] limit = perHundred(limitAlarms, wafers);
		int[] runLevel = perHundred(runLevelAlarms, wafers);
		try (PrintStream out = new PrintStream(Files.newOutputStream(Path.of("target", "sim-calibration.txt")), true,
				StandardCharsets.UTF_8)) {
			out.println("threshold  limit alarms per 100: public simulated  run-level alarms per 100: public simulated");
			for (int i = 0; i < 6; i++) {
				out.printf(Locale.ROOT, "%d  %d %d  %d %d%n", i + 3, PUBLIC_LIMIT[i], limit[i], PUBLIC_RUN_LEVEL[i],
						runLevel[i]);
			}
			out.printf(Locale.ROOT, "%d simulated wafers%n%nchannel  median band sd: simulated public  ratio%n", wafers);
			for (Map.Entry<ChannelName, ChannelBand> entry : firstBaseline.bands().entrySet()) {
				Double publicSd = PUBLIC_MEDIAN_BAND_SD.get(entry.getKey().value());
				if (entry.getValue().role() == ChannelRole.INFORMATIVE && publicSd != null) {
					double simulated = medianSd(entry.getValue());
					out.printf(Locale.ROOT, "%s  %.4g %.4g  %.2f%n", entry.getKey(), simulated, publicSd, simulated / publicSd);
				}
			}
		}

		for (int i = 0; i < 6; i++) {
			int tolerance = (i < 3) ? 10 : 5;
			assertThat(limit[i]).as("limit alarms per 100 at k = %d", i + 3).isCloseTo(PUBLIC_LIMIT[i], within(tolerance));
			assertThat(runLevel[i]).as("run-level alarms per 100 at %d", i + 3)
				.isCloseTo(PUBLIC_RUN_LEVEL[i], within(tolerance));
		}
	}

	private static double medianSd(ChannelBand band) {
		double[] sds = new double[band.slotCount()];
		int banded = 0;
		for (int slot = 0; slot < band.slotCount(); slot++) {
			if (band.hasBand(slot)) {
				sds[banded++] = band.sd(slot);
			}
		}
		double[] sorted = Arrays.stream(sds, 0, banded).sorted().toArray();
		return (banded == 0) ? Double.NaN : sorted[banded / 2];
	}

	private static int[] perHundred(int[] counts, int total) {
		int[] rates = new int[counts.length];
		for (int i = 0; i < counts.length; i++) {
			rates[i] = (int) Math.round(100.0 * counts[i] / total);
		}
		return rates;
	}

}
