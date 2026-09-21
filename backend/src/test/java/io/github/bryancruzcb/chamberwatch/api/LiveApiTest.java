package io.github.bryancruzcb.chamberwatch.api;

import io.github.bryancruzcb.chamberwatch.TestcontainersConfiguration;
import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.assertj.MockMvcTester;

import static org.assertj.core.api.Assertions.assertThat;

/** The live endpoints with no simulator anywhere: what the page sees before anything has been recorded. */
@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class LiveApiTest {

	@Autowired
	private MockMvcTester mvc;

	@Test
	void anIdleSessionSaysSoRatherThanFailing() {
		assertThat(mvc.get().uri("/api/live/session")).hasStatusOk()
			.bodyJson()
			.extractingPath("$.recording")
			.isEqualTo(false);
	}

	@Test
	void aStartWithoutASimulatorIsAcceptedThenReportsWhatWentWrong() throws Exception {
		assertThat(mvc.post()
			.uri("/api/live/start")
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"host\":\"127.0.0.1\",\"port\":1}")).hasStatus(HttpStatus.ACCEPTED);

		// the recording runs on a thread of its own, so the failure arrives at the session a moment later
		String failure = null;
		for (int attempt = 0; attempt < 100 && failure == null; attempt++) {
			failure = mvc.get()
				.uri("/api/live/session")
				.exchange()
				.getResponse()
				.getContentAsString()
				.contains("\"failure\":null") ? null : "reported";
			if (failure == null) {
				Thread.sleep(50);
			}
		}
		assertThat(failure).as("the session reports why the recording stopped").isNotNull();
		assertThat(mvc.get().uri("/api/live/session")).hasStatusOk()
			.bodyJson()
			.extractingPath("$.failure")
			.asString()
			.contains("cannot reach a chamber simulator");
	}

	@Test
	void aPortThatIsNotAPortIsRefused() {
		assertThat(mvc.post()
			.uri("/api/live/start")
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"host\":\"127.0.0.1\",\"port\":70000}")).hasStatus(HttpStatus.BAD_REQUEST);
	}

	@Test
	void aFaultCannotBeInjectedIntoAWaferThatIsNotBeingEtched() {
		assertThat(mvc.post()
			.uri("/api/live/inject")
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"kind\":\"SENSOR_STUCK\",\"channel\":\"HeliumBPPressure\",\"startS\":12.0}"))
			.hasStatus(HttpStatus.CONFLICT);

		assertThat(mvc.post()
			.uri("/api/live/inject")
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"kind\":\"SENSOR_STUCK\"}")).hasStatus(HttpStatus.BAD_REQUEST);
	}

}
