package io.github.bryancruzcb.chamberwatch.eval;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.SortedMap;

import io.github.bryancruzcb.chamberwatch.sim.SimulationTemplate;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

/**
 * Runs the committed evaluation and compares it with results/metrics.json: a rate may move by 0.02 and a
 * latency by 0.5 s; configuration and run counts must match exactly. To accept a change on purpose, run
 * {@code ./mvnw test -Dtest=EvaluationRegressionTest -Dchamberwatch.writeMetrics=true} and commit the file.
 */
class EvaluationRegressionTest {

	private static final Path METRICS = Path.of("..", "results", "metrics.json");

	@Test
	void theEvaluationMatchesTheCommittedMetrics() throws IOException {
		Metrics metrics = Evaluation.run(EvaluationConfig.defaults(), SimulationTemplate.bundled());
		if (Boolean.getBoolean("chamberwatch.writeMetrics")) {
			Files.createDirectories(METRICS.getParent());
			Files.writeString(METRICS, metrics.format(), StandardCharsets.UTF_8);
		}

		SortedMap<String, Double> committed = MetricsFile.parse(Files.readString(METRICS, StandardCharsets.UTF_8));

		assertThat(metrics.values().keySet()).containsExactlyElementsOf(committed.keySet());
		committed.forEach((name, expected) -> assertThat(metrics.get(name)).as(name)
			.isCloseTo(expected, within(tolerance(name) + 5e-5)));
	}

	private static double tolerance(String name) {
		if (name.endsWith("LatencyS")) {
			return 0.5;
		}
		if (name.endsWith("Rate") || name.endsWith("recall") || name.endsWith("precision")
				|| name.contains("flaggedRate") || name.contains("FlaggedRate")) {
			return 0.02;
		}
		return 0;
	}

}
