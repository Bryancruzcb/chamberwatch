package io.github.bryancruzcb.chamberwatch.sim;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;
import io.github.bryancruzcb.chamberwatch.recipe.Phase;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

class SimulationTemplateTest {

	@Test
	void theBundledTemplateFormatsBackToItsOwnText() throws IOException {
		String text;
		try (InputStream stream = SimulationTemplate.class.getResourceAsStream(SimulationTemplate.RESOURCE)) {
			text = new String(stream.readAllBytes(), StandardCharsets.UTF_8);
		}

		assertThat(SimulationTemplate.bundled().format()).isEqualTo(text.replace("\r\n", "\n"));
	}

	@Test
	void theTemplateCoversThePublicChannelsWithTheirPhaseLevels() {
		SimulationTemplate template = SimulationTemplate.bundled();

		assertThat(template.channels()).hasSize(31);
		assertThat(template.channel(ChannelName.GAS5_FLOW).phase(Phase.SF6).level(1, 20)).isCloseTo(600, within(1.0));
		assertThat(template.channel(ChannelName.GAS4_FLOW).phase(Phase.C4F8).level(1, 4)).isCloseTo(300, within(1.0));
		assertThat(template.channel(ChannelName.of("Gas3Flow")).constant()).isPresent();
	}

	@Test
	void theDriftIsAProfileByWaferPositionThatStartsAtTheFirstThreeWafersAndLevelsOff() {
		ChannelTemplate.PhaseTemplate tuning = SimulationTemplate.bundled()
			.channel(ChannelName.of("PlatenRFTuningCapacitor"))
			.phase(Phase.SF6);

		assertThat(tuning.drift()).hasSize(10);
		// a lot's level is where its first three wafers sit, so the profile averages to nothing over them
		assertThat(tuning.driftAt(1) + tuning.driftAt(2) + tuning.driftAt(3)).isCloseTo(0, within(1e-3));
		// the public lots climb to wafer 7 and stay: a line through the first wafers would pass 0.7 by wafer 10
		assertThat(tuning.driftAt(7)).isBetween(0.30, 0.35);
		assertThat(tuning.driftAt(10)).isCloseTo(tuning.driftAt(7), within(0.02));
		assertThat(tuning.driftAt(12)).isEqualTo(tuning.driftAt(10));
		assertThat(tuning.driftAt(0)).isEqualTo(tuning.driftAt(1));
		assertThat(tuning.driftScaleSd()).isBetween(0.0, 0.5);
	}

}
