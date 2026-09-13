package io.github.bryancruzcb.chamberwatch.ingest;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import io.github.bryancruzcb.chamberwatch.recipe.AlignmentReport;
import io.github.bryancruzcb.chamberwatch.recipe.AlignmentResult;
import io.github.bryancruzcb.chamberwatch.recipe.AlignmentStatus;
import io.github.bryancruzcb.chamberwatch.recipe.Aligner;
import io.github.bryancruzcb.chamberwatch.recipe.RunKey;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.entry;

/**
 * Aligns the 96 public wafers. The data is never committed, so this runs only where it has been
 * downloaded as docs/DATA.md describes, and CI skips it.
 */
@EnabledIf("publicDataPresent")
class PublicDataAlignmentTest {

	private static final Path DATA = Path.of("../data/public/zenodo17122442");

	private static final Path MD5_LIST = Path.of("../docs/zenodo17122442.md5");

	static boolean publicDataPresent() {
		return Files.exists(DATA.resolve(AlignCommand.PROCESS_DATA));
	}

	@Test
	void everyPublicWaferAlignsOntoTheGrid() {
		Map<String, DataFiles.VerifiedFile> files = DataFiles.verify(DATA, MD5_LIST,
				List.of(AlignCommand.PROCESS_DATA, AlignCommand.DICTIONARY));
		List<String> problems = new ArrayList<>();
		List<String> shortEtches = new ArrayList<>();
		Map<String, List<Integer>> irregular = new TreeMap<>();
		int wafers = 0;
		try (NetcdfTelemetrySource source = NetcdfTelemetrySource.open(files.get(AlignCommand.PROCESS_DATA),
				files.get(AlignCommand.DICTIONARY))) {
			for (RunKey key : source.keys()) {
				wafers++;
				AlignmentResult result = Aligner.STANDARD.align(source.read(key));
				if (result instanceof AlignmentResult.Failed failed) {
					problems.add(key.value() + " failed: " + failed.reason());
					continue;
				}
				AlignmentReport report = result.orElseThrow().report();
				boolean fullEtch = report.c4f8Phases() == 99 && report.lastCycle() == 100;
				boolean shortEtch = report.c4f8Phases() == 98 && report.lastCycle() == 99;
				if (report.status() != AlignmentStatus.ALIGNED || report.steadyOverflowSamples() != 0
						|| !(fullEtch || shortEtch)) {
					problems.add(AlignCommand.describe(key, report));
				}
				if (shortEtch) {
					shortEtches.add(key.value());
				}
				if (!report.irregularCycles().isEmpty()) {
					irregular.put(key.value(), report.irregularCycles());
				}
			}
		}

		assertThat(wafers).isEqualTo(96);
		assertThat(problems).isEmpty();
		assertThat(shortEtches).containsExactly("Day_2024_07_09_Wafer_10", "Day_2024_07_11_Wafer_09",
				"Day_2024_07_19_Wafer_02");
		assertThat(irregular).containsExactly(entry("Day_2024_07_09_Wafer_07", List.of(74)));
	}

}
