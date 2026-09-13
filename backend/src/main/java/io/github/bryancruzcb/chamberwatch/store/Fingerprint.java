package io.github.bryancruzcb.chamberwatch.store;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Collection;
import java.util.HexFormat;
import java.util.TreeSet;
import java.util.regex.Pattern;

import io.github.bryancruzcb.chamberwatch.detect.DetectorConfig;
import io.github.bryancruzcb.chamberwatch.recipe.RunKey;
import io.github.bryancruzcb.chamberwatch.recipe.Source;

/**
 * The identity of a baseline: everything that decides its bands and its assessments. Equal fingerprints
 * mean an identical fit, so a refresh that finds a stored one reuses it and writes nothing.
 *
 * @param hex the sha-256 of a canonical text, 64 lowercase hex characters
 */
public record Fingerprint(String hex) {

	private static final Pattern HEX = Pattern.compile("[0-9a-f]{64}");

	public Fingerprint {
		if (hex == null || !HEX.matcher(hex).matches()) {
			throw new IllegalArgumentException("not a sha-256 hex digest: " + hex);
		}
	}

	/**
	 * The drift rule and the good-run policy are left out. Drift is judged when a lot is read, and the
	 * policy matters only through the good runs it picked.
	 */
	public static Fingerprint of(Source source, Collection<RunKey> goodRuns, DetectorConfig config, int alignerVersion,
			int detectorVersion) {
		DetectorConfig.BandRule band = config.band();
		StringBuilder text = new StringBuilder().append("source=")
			.append(source)
			.append("\naligner=")
			.append(alignerVersion)
			.append("\ndetector=")
			.append(detectorVersion)
			.append("\nband=")
			.append(band.poolHalfWidthCycles())
			.append(',')
			.append(band.relativeSdFloor())
			.append(',')
			.append(band.minObservations())
			.append(',')
			.append(band.maxDistinctTracked())
			.append("\nlimit=")
			.append(config.limit().k())
			.append(',')
			.append(config.limit().n())
			.append("\nrunZ=")
			.append(config.runZ())
			.append('\n');
		for (RunKey key : new TreeSet<>(goodRuns)) {
			text.append("good=").append(key.value()).append('\n');
		}
		try {
			byte[] digest = MessageDigest.getInstance("SHA-256").digest(text.toString().getBytes(StandardCharsets.UTF_8));
			return new Fingerprint(HexFormat.of().formatHex(digest));
		}
		catch (NoSuchAlgorithmException ex) {
			throw new IllegalStateException("every Java runtime provides SHA-256", ex);
		}
	}

}
