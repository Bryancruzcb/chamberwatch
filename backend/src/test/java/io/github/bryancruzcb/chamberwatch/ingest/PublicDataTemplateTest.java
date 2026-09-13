package io.github.bryancruzcb.chamberwatch.ingest;

import java.io.IOException;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import io.github.bryancruzcb.chamberwatch.sim.SimulationTemplate;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Builds the simulation template from the public wafers and checks it is the committed one, so the template
 * cannot drift from the code that measures it. Runs only where the data has been downloaded.
 */
@EnabledIf("publicDataPresent")
class PublicDataTemplateTest {

	private static final Path DATA = Path.of("../data/public/zenodo17122442");

	private static final Path MD5_LIST = Path.of("../docs/zenodo17122442.md5");

	static boolean publicDataPresent() {
		return Files.exists(DATA.resolve(AlignCommand.PROCESS_DATA));
	}

	@Test
	void theCommittedTemplateIsWhatThePublicWafersGive() throws IOException {
		SimulationTemplate built = SimTemplateCommand.build(DATA, MD5_LIST, new PrintStream(System.out, true, StandardCharsets.UTF_8));

		String committed = Files.readString(Path.of(SimTemplateCommand.DEFAULT_OUT), StandardCharsets.UTF_8);

		assertThat(built.format()).isEqualTo(committed.replace("\r\n", "\n"));
	}

}
