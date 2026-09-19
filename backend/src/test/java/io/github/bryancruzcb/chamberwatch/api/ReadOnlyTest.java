package io.github.bryancruzcb.chamberwatch.api;

import io.github.bryancruzcb.chamberwatch.health.RefreshQueue;
import io.github.bryancruzcb.chamberwatch.store.ReadQueries;
import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.assertj.MockMvcTester;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verifyNoInteractions;

/** A public demo runs read-only: the web app is told so, and a relabel is refused before anything is written. */
@WebMvcTest(controllers = { RunsController.class, SettingsController.class }, properties = "chamberwatch.read-only=true")
class ReadOnlyTest {

	@Autowired
	private MockMvcTester mvc;

	@MockitoBean
	private ReadQueries queries;

	@MockitoBean
	private RefreshQueue refreshes;

	@Test
	void theSettingsSayReadOnly() {
		assertThat(mvc.get().uri("/api/settings")).hasStatusOk().bodyJson().extractingPath("$.readOnly").isEqualTo(true);
	}

	@Test
	void aRelabelIsRefusedWithAProblemDetailAndWritesNothing() {
		var refused = assertThat(mvc.put()
			.uri("/api/runs/{id}/label", 55)
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"label\": \"GOOD\"}")).hasStatus(HttpStatus.FORBIDDEN).bodyJson();

		refused.extractingPath("$.detail").isEqualTo("this ChamberWatch is read-only, so labels cannot be changed here");
		verifyNoInteractions(refreshes);
	}

}
