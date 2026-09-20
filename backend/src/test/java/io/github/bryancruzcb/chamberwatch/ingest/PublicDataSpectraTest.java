package io.github.bryancruzcb.chamberwatch.ingest;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

import io.github.bryancruzcb.chamberwatch.recipe.AlignedRun;
import io.github.bryancruzcb.chamberwatch.recipe.Aligner;
import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;
import io.github.bryancruzcb.chamberwatch.recipe.Phase;
import io.github.bryancruzcb.chamberwatch.recipe.RecipeGrid;
import io.github.bryancruzcb.chamberwatch.recipe.RunKey;
import io.github.bryancruzcb.chamberwatch.spectra.EmissionLines;
import io.github.bryancruzcb.chamberwatch.spectra.NetcdfSpectraSource;
import io.github.bryancruzcb.chamberwatch.spectra.SpectraReduction;
import io.github.bryancruzcb.chamberwatch.spectra.WaferSpectra;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The reduction on one day of real wafers, straight from the files. The dataset is not in the repository, so this
 * runs only where it has been downloaded, and CI skips it.
 */
@EnabledIf("publicDataPresent")
class PublicDataSpectraTest {

	private static final Path DATA = Path.of("../data/public/zenodo17122442");

	private static final Path MD5_LIST = Path.of("../docs/zenodo17122442.md5");

	private static final String DAY = "Day_2024_08_05.nc";

	static boolean publicDataPresent() {
		return Files.exists(DATA.resolve(DAY)) && Files.exists(DATA.resolve(AlignCommand.PROCESS_DATA));
	}

	@Test
	void everyWaferOfADayLinesUpAndItsPhasesSeparate() {
		Map<String, DataFiles.VerifiedFile> files = DataFiles.verify(DATA, MD5_LIST,
				List.of(AlignCommand.PROCESS_DATA, AlignCommand.DICTIONARY, DAY, "Dictionary_OES.nc"));
		List<String> lines = new ArrayList<>();
		Map<RunKey, Boolean> usable = new LinkedHashMap<>();
		try (NetcdfTelemetrySource telemetry = NetcdfTelemetrySource.open(files.get(AlignCommand.PROCESS_DATA),
				files.get(AlignCommand.DICTIONARY));
				NetcdfSpectraSource spectra = NetcdfSpectraSource.open(files.get(DAY).path(),
						files.get("Dictionary_OES.nc").path())) {
			for (RunKey key : spectra.keys()) {
				AlignedRun run = Aligner.STANDARD.align(telemetry.read(key)).orElseThrow();
				WaferSpectra record = spectra.read(key, NetcdfSpectraSource.standardLines());
				Optional<SpectraReduction.Reduced> reduced = SpectraReduction.reduce(record, run.copySlotTimes(),
						RecipeGrid.STANDARD, run.report().etchStartS());

				assertThat(reduced).as(key.value()).isPresent();
				SpectraReduction.Report report = reduced.get().report();
				double ratio = phaseRatio(reduced.get().values().get(EmissionLines.PASSIVATION), run);
				lines.add(key.value() + ": " + report.describe() + String.format(", C4F8 over SF6 %.1f", ratio));

				// the two clocks already agree to a twentieth of a second, and the recipe settles the rest
				assertThat(report.contrast()).as(key.value() + " contrast").isGreaterThan(4.0);
				assertThat(Math.abs(report.offsetS())).as(key.value() + " offset").isLessThan(0.1);
				// the C2 head reads about 40 times higher in the phase that lays the carbon down
				assertThat(ratio).as(key.value() + " phase ratio").isGreaterThan(25.0);
				usable.put(key, report.usable());
			}
		}
		System.out.println(String.join("\n", lines));
		assertThat(lines).hasSize(6);
	}

	/** The passivation line's mean in the C4F8 slots over its mean in the SF6 slots, over the steady cycles. */
	private static double phaseRatio(float[] values, AlignedRun run) {
		double sf6 = 0;
		double c4f8 = 0;
		int sf6Slots = 0;
		int c4f8Slots = 0;
		for (int slot = 0; slot < values.length; slot++) {
			int cycle = RecipeGrid.STANDARD.position(slot).cycle();
			if (Float.isNaN(values[slot]) || !run.isScored(cycle)) {
				continue;
			}
			if (RecipeGrid.STANDARD.position(slot).phase() == Phase.SF6) {
				sf6 += values[slot];
				sf6Slots++;
			}
			else {
				c4f8 += values[slot];
				c4f8Slots++;
			}
		}
		return (c4f8 / c4f8Slots) / (sf6 / sf6Slots);
	}

	/** Names the reduction stores, so a rename cannot pass unnoticed. */
	@Test
	void theLinesAreNamedForTheirWavelengths() {
		assertThat(EmissionLines.STANDARD.stream().map((line) -> line.channel().value()).toList())
			.containsExactly("Emission685", "Emission703", "Emission623", "Emission516", "Emission563");
		assertThat(EmissionLines.PLASMA).isEqualTo(ChannelName.of("Emission685"));
	}

}
