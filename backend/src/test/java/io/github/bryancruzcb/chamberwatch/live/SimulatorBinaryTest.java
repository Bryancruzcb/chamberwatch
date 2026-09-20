package io.github.bryancruzcb.chamberwatch.live;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;

import io.github.bryancruzcb.chamberwatch.TestcontainersConfiguration;
import io.github.bryancruzcb.chamberwatch.store.RunStore;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The done-when of plan item 6, against the real program: a wafer streamed by the C chamber simulator ends up in
 * the runs table, aligned and scored, with the fault it was given beside it.
 *
 * <p>It runs where the binary has been built, which CI does before the backend job; elsewhere it is skipped, so
 * a machine without a C compiler still runs the rest of the suite.
 */
@SpringBootTest
@Import(TestcontainersConfiguration.class)
@EnabledIf("simulatorBuilt")
class SimulatorBinaryTest {

	private static final boolean WINDOWS = System.getProperty("os.name", "").startsWith("Windows");

	/** The build directory can hold a binary for either platform, so the one this platform can run is chosen. */
	private static final Path[] CANDIDATES = WINDOWS
			? new Path[] { Path.of("../chamber-sim/build/chamber-sim.exe") }
			: new Path[] { Path.of("../chamber-sim/build/chamber-sim") };

	@Autowired
	private LiveRunService live;

	@Autowired
	private RunStore runs;

	@Autowired
	private JdbcClient jdbc;

	static boolean simulatorBuilt() {
		return binary() != null;
	}

	private static Path binary() {
		String named = System.getProperty("chamberwatch.simulator");
		if (named != null && Files.isExecutable(Path.of(named))) {
			return Path.of(named);
		}
		for (Path candidate : CANDIDATES) {
			if (Files.isRegularFile(candidate)) {
				return candidate;
			}
		}
		return null;
	}

	@Test
	void aWaferTheCSimulatorEtchesEndsUpStoredAndScored() throws IOException, InterruptedException {
		Process simulator = new ProcessBuilder(binary().toAbsolutePath().toString(), "--port=0", "--rate=0",
				"--seed=7", "--lot=5", "--wafer=1", "--fault=random")
			.redirectErrorStream(false)
			.start();
		try {
			int port;
			try (BufferedReader out = new BufferedReader(
					new InputStreamReader(simulator.getInputStream(), StandardCharsets.UTF_8))) {
				String listening = out.readLine();
				assertThat(listening).as("the simulator prints the port it took").contains("\"listening\"");
				port = Integer.parseInt(listening.replaceAll(".*\"port\":(\\d+).*", "$1"));

				LiveRunService.Recorded recorded = live.record("127.0.0.1", port);

				assertThat(recorded.key().value()).isEqualTo("LIVE-s7-L5-W01");
				assertThat(recorded.reason()).isEqualTo("COMPLETE");
				assertThat(recorded.stored()).isTrue();
				// the recipe is 100 cycles at 5 Hz, about eleven minutes of model time
				assertThat(recorded.samples()).isBetween(2700, 3600);
				assertThat(recorded.alignment()).contains("ALIGNED");
				assertThat(recorded.fault()).as("--fault=random puts one in").isPresent();

				assertThat(runs.exists(recorded.key())).isTrue();
				assertThat(runs.injectedFault(recorded.id())).isPresent();
				assertThat(count("select count(*) from run_assessment a join baseline b on b.id = a.baseline_id "
						+ "where b.source = 'LIVE' and a.run_id = " + recorded.id().value())).isEqualTo(1);
				assertThat(count("select count(*) from run_phase_summary where run_id = " + recorded.id().value()))
					.isPositive();
			}
		}
		finally {
			simulator.destroy();
			simulator.waitFor(10, TimeUnit.SECONDS);
		}
	}

	private long count(String sql) {
		return jdbc.sql(sql).query(Long.class).single();
	}

}
