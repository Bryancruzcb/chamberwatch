package io.github.bryancruzcb.chamberwatch.ingest;

import java.io.PrintStream;
import java.nio.file.Path;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import io.github.bryancruzcb.chamberwatch.recipe.AlignmentReport;
import io.github.bryancruzcb.chamberwatch.recipe.AlignmentResult;
import io.github.bryancruzcb.chamberwatch.recipe.AlignmentStatus;
import io.github.bryancruzcb.chamberwatch.recipe.Aligner;
import io.github.bryancruzcb.chamberwatch.recipe.RunKey;

/**
 * The {@code align} command: aligns every public wafer and prints one line per wafer, writing
 * nothing. It needs no database, so the application runs it before Spring starts.
 */
public final class AlignCommand {

	static final String PROCESS_DATA = "Process_data.nc";

	static final String DICTIONARY = "Dictionary_process.nc";

	private AlignCommand() {
	}

	public static void main(String[] args) {
		System.exit(run(List.of(args), System.out));
	}

	/**
	 * @param args {@code --data=<dir>} and {@code --md5=<list>}, defaulting to the repository layout
	 * @return 0 when every wafer aligned cleanly, 1 otherwise
	 */
	public static int run(List<String> args, PrintStream out) {
		Path dataDir = Path.of(option(args, "data", "data/public/zenodo17122442"));
		Path md5List = Path.of(option(args, "md5", "docs/zenodo17122442.md5"));
		Map<String, DataFiles.VerifiedFile> files = DataFiles.verify(dataDir, md5List, List.of(PROCESS_DATA, DICTIONARY));
		int aligned = 0;
		int degraded = 0;
		int failed = 0;
		try (NetcdfTelemetrySource source = NetcdfTelemetrySource.open(files.get(PROCESS_DATA), files.get(DICTIONARY))) {
			for (RunKey key : source.keys()) {
				switch (Aligner.STANDARD.align(source.read(key))) {
					case AlignmentResult.Aligned result -> {
						AlignmentReport report = result.run().report();
						if (report.status() == AlignmentStatus.ALIGNED) {
							aligned++;
						}
						else {
							degraded++;
						}
						out.println(describe(key, report));
					}
					case AlignmentResult.Failed result -> {
						failed++;
						out.println(key.value() + " FAILED " + result.reason());
					}
				}
			}
		}
		out.printf(Locale.ROOT, "%d aligned, %d degraded, %d failed%n", aligned, degraded, failed);
		return (degraded + failed == 0) ? 0 : 1;
	}

	static String describe(RunKey key, AlignmentReport report) {
		String gap = report.largestGap()
			.map((g) -> String.format(Locale.ROOT, "%.1fs+%.1fs%s", g.startS(), g.lengthS(), g.insideEtch() ? "-inside" : ""))
			.orElse("none");
		return String.format(Locale.ROOT,
				"%s %s c4f8=%d lastCycle=%d onsets=%d/%d cycle1Sf6=%s etch=%.1f-%.1fs overflow=%d/%d collisions=%d gap=%s irregular=%s%s",
				key.value(), report.status(), report.c4f8Phases(), report.lastCycle(), report.onsetsDetected(),
				report.onsetsPredicted(),
				report.cycle1Sf6() ? "yes" : "no", report.etchStartS(), report.etchEndS(),
				report.steadyOverflowSamples(), report.edgeOverflowSamples(), report.slotCollisions(), gap,
				report.irregularCycles(), report.note().map((note) -> " (" + note + ")").orElse(""));
	}

	private static String option(List<String> args, String name, String fallback) {
		String prefix = "--" + name + "=";
		return args.stream()
			.filter((arg) -> arg.startsWith(prefix))
			.map((arg) -> arg.substring(prefix.length()))
			.findFirst()
			.orElse(fallback);
	}

}
