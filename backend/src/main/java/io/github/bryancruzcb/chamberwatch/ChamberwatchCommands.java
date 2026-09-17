package io.github.bryancruzcb.chamberwatch;

import java.nio.file.Path;
import java.util.List;
import java.util.Set;

import io.github.bryancruzcb.chamberwatch.ingest.IngestReport;
import io.github.bryancruzcb.chamberwatch.ingest.IngestService;
import io.github.bryancruzcb.chamberwatch.ingest.SimulateLotReport;
import io.github.bryancruzcb.chamberwatch.ingest.SimulateLotService;
import io.github.bryancruzcb.chamberwatch.recipe.Source;
import io.github.bryancruzcb.chamberwatch.store.ReadQueries;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.ExitCodeGenerator;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

/**
 * Command-line commands that need the database. {@link ChamberwatchApplication} starts Spring without
 * a web server when the first argument names one of them, and exits with the command's status. With
 * no command the application serves the API and this runner does nothing.
 */
@Component
public class ChamberwatchCommands implements ApplicationRunner, ExitCodeGenerator {

	static final Set<String> NAMES = Set.of("ingest", "simulate-lot", "report");

	private final IngestService ingest;

	private final SimulateLotService simulateLot;

	private final ReadQueries queries;

	private final JsonMapper json;

	private int exitCode;

	public ChamberwatchCommands(IngestService ingest, SimulateLotService simulateLot, ReadQueries queries,
			JsonMapper json) {
		this.ingest = ingest;
		this.simulateLot = simulateLot;
		this.queries = queries;
		this.json = json;
	}

	@Override
	public void run(ApplicationArguments args) {
		List<String> commands = args.getNonOptionArgs();
		if (commands.isEmpty() || !NAMES.contains(commands.get(0))) {
			return;
		}
		switch (commands.get(0)) {
			case "ingest" -> {
				IngestReport report = ingest.ingestPublic(Path.of(option(args, "data", "data/public/zenodo17122442")),
						Path.of(option(args, "md5", "docs/zenodo17122442.md5")));
				System.out.println(report.describe());
				exitCode = report.hasProblems() ? 1 : 0;
			}
			case "simulate-lot" -> {
				SimulateLotReport report = simulateLot.simulate(Long.parseLong(option(args, "seed", "7")),
						Integer.parseInt(option(args, "lot", "901")), Integer.parseInt(option(args, "wafers", "10")),
						Integer.parseInt(option(args, "training-lots", "10")));
				System.out.println(report.describe());
				exitCode = report.hasProblems() ? 1 : 0;
			}
			case "report" -> {
				System.out.println(ReportCommand.write(queries, json, Source.valueOf(option(args, "source", "PUBLIC")),
						Path.of(option(args, "out", "results/public-drift.json"))));
				exitCode = 0;
			}
			default -> throw new IllegalStateException("no such command " + commands.get(0));
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
