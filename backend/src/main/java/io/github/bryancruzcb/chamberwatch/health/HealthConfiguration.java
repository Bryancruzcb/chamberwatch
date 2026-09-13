package io.github.bryancruzcb.chamberwatch.health;

import io.github.bryancruzcb.chamberwatch.detect.DetectorConfig;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
class HealthConfiguration {

	@Bean
	DetectorConfig detectorConfig() {
		return DetectorConfig.defaults();
	}

}
