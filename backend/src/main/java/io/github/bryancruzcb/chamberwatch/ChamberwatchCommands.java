package io.github.bryancruzcb.chamberwatch;

import java.nio.file.Path;
import java.util.List;
import java.util.Set;

import io.github.bryancruzcb.chamberwatch.ingest.IngestReport;
import io.github.bryancruzcb.chamberwatch.ingest.IngestService;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.ExitCodeGenerator;
import org.springframework.stereotype.Component;

/**
 * Command-line commands that need the database. {@link ChamberwatchApplication} starts Spring without
 * a web server when the first argument names one of them, and exits with the command's status. With
 * no command the application serves the API and this runner does nothing.
 */
@Component
public class ChamberwatchCommands implements ApplicationRunner, ExitCodeGenerator {

	static final Set<String> NAMES = Set.of("ingest");

	private final IngestService ingest;

	private int exitCode;

	public ChamberwatchCommands(IngestService ingest) {
		this.ingest = ingest;
	}

	@Override
	public void run(ApplicationArguments args) {
		List<String> commands = args.getNonOptionArgs();
		if (commands.isEmpty() || !NAMES.contains(commands.get(0))) {
			return;
		}
		if (commands.get(0).equals("ingest")) {
			IngestReport report = ingest.ingestPublic(Path.of(option(args, "data", "data/public/zenodo17122442")),
					Path.of(option(args, "md5", "docs/zenodo17122442.md5")));
			System.out.println(report.describe());
			exitCode = (report.failed() == 0) ? 0 : 1;
		}
	}

	@Override
	public int getExitCode() {
		return exitCode;
	}

	private static String option(ApplicationArguments args, String name, String fallback) {
		List<String> values = args.getOptionValues(name);
		return (values == null || values.isEmpty()) ? fallback : values.get(0);
	}

}
