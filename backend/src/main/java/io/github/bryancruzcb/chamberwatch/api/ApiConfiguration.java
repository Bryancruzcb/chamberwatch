package io.github.bryancruzcb.chamberwatch.api;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
class ApiConfiguration {

	/** The title and summary of the description served at /v3/api-docs. */
	@Bean
	OpenAPI chamberwatchOpenApi() {
		return new OpenAPI().info(new Info().title("ChamberWatch")
			.version("v1")
			.description("Plasma etch runs on a fixed recipe grid, the flags the detectors raised on them, "
					+ "their traces against the good-run band, and wafer measurements."));
	}

}
