package io.github.bryancruzcb.chamberwatch.api;

import io.github.bryancruzcb.chamberwatch.ChamberwatchProperties;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** What the web app needs to know about this server before it offers an action. */
@RestController
class SettingsController {

	/** @param readOnly relabels are refused, so the run page shows the label without the buttons */
	record Settings(boolean readOnly) {
	}

	private final ChamberwatchProperties properties;

	SettingsController(ChamberwatchProperties properties) {
		this.properties = properties;
	}

	@GetMapping("/api/settings")
	Settings settings() {
		return new Settings(properties.readOnly());
	}

}
