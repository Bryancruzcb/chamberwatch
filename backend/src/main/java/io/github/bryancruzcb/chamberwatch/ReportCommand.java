package io.github.bryancruzcb.chamberwatch;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;

import io.github.bryancruzcb.chamberwatch.recipe.Source;
import io.github.bryancruzcb.chamberwatch.store.ReadQueries;

import tools.jackson.core.PrettyPrinter;
import tools.jackson.core.util.DefaultIndenter;
import tools.jackson.core.util.DefaultPrettyPrinter;
import tools.jackson.core.util.Separators;
import tools.jackson.databind.json.JsonMapper;

/**
 * The {@code report} command: writes the drift-versus-depth report, the same object
 * {@code GET /api/reports/drift-vs-depth} serves, to a file as pretty-printed JSON.
 */
final class ReportCommand {

	/** Two-space indents, LF on every platform and {@code "name": value}, so the file diffs cleanly when committed. */
	private static final PrettyPrinter PRETTY = new DefaultPrettyPrinter(
			Separators.createDefaultInstance().withObjectNameValueSpacing(Separators.Spacing.AFTER))
		.withObjectIndenter(new DefaultIndenter("  ", "\n"))
		.withArrayIndenter(new DefaultIndenter("  ", "\n"));

	private ReportCommand() {
	}

	/** @return one line saying what was written */
	static String write(ReadQueries queries, JsonMapper mapper, Source source, Path out) {
		ReadQueries.DriftVsDepth report = queries.driftVsDepth(source);
		try {
			Path parent = out.toAbsolutePath().getParent();
			if (parent != null) {
				Files.createDirectories(parent);
			}
			Files.writeString(out, mapper.writer().with(PRETTY).writeValueAsString(report) + "\n", StandardCharsets.UTF_8);
		}
		catch (IOException ex) {
			throw new UncheckedIOException(ex);
		}
		return String.format(Locale.ROOT, "wrote %s: %s drift versus depth over %d positions, baseline %s",
				out.toAbsolutePath(), source, report.positions().size(),
				(report.baseline() != null) ? String.valueOf(report.baseline().id()) : "none");
	}

}
