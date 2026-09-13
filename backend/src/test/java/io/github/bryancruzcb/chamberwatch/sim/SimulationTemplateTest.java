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

}
