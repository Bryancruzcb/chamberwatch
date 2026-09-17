package io.github.bryancruzcb.chamberwatch;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import io.github.bryancruzcb.chamberwatch.recipe.Source;
import io.github.bryancruzcb.chamberwatch.store.ReadQueries;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@Import(TestcontainersConfiguration.class)
class ReportCommandTest {

	@Autowired
	private ReadQueries queries;

	@Autowired
	private JsonMapper json;

	@Test
	void writesTheReportTheApiServesAsJson(@TempDir Path dir) throws Exception {
		Path out = dir.resolve("results").resolve("public-drift.json");

		String line = ReportCommand.write(queries, json, Source.PUBLIC, out);

		String text = Files.readString(out, StandardCharsets.UTF_8);
		ReadQueries.DriftVsDepth written = json.readValue(text, ReadQueries.DriftVsDepth.class);
		assertThat(written).usingRecursiveComparison().isEqualTo(queries.driftVsDepth(Source.PUBLIC));
		assertThat(written.source()).isEqualTo(Source.PUBLIC);
		assertThat(text).startsWith("{\n").endsWith("}\n");
		assertThat(line).startsWith("wrote " + out.toAbsolutePath()).contains("PUBLIC drift versus depth");
	}

}
