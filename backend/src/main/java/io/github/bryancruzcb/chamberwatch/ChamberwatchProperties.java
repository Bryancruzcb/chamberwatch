package io.github.bryancruzcb.chamberwatch;

import java.net.URI;
import java.nio.file.Path;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Settings under {@code chamberwatch.*}, also read from the environment, for example
 * {@code CHAMBERWATCH_READ_ONLY=true} or {@code CHAMBERWATCH_BOOTSTRAP=true}.
 *
 * @param readOnly  refuse relabels, so visitors to a public demo cannot refit its baseline
 * @param bootstrap fill an empty database once the web server is up: the public files from Zenodo, their ingest,
 *                  and the simulated demo lot
 * @param dataDir   where the bootstrap keeps the public files
 * @param md5List   the committed MD5 list the public files are checked against
 * @param zenodo    the record's file listing, each file under {@code <name>/content}
 */
@ConfigurationProperties("chamberwatch")
public record ChamberwatchProperties(boolean readOnly, boolean bootstrap,
		@DefaultValue("data/public/zenodo17122442") Path dataDir, @DefaultValue("docs/zenodo17122442.md5") Path md5List,
		@DefaultValue("https://zenodo.org/api/records/17122442/files/") URI zenodo) {
}
