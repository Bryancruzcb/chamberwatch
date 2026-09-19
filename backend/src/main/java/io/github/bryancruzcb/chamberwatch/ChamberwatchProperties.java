package io.github.bryancruzcb.chamberwatch;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Settings under {@code chamberwatch.*}, also read from the environment ({@code CHAMBERWATCH_READ_ONLY=true}).
 *
 * @param readOnly refuse relabels, so visitors to a public demo cannot refit its baseline
 */
@ConfigurationProperties("chamberwatch")
public record ChamberwatchProperties(boolean readOnly) {
}
