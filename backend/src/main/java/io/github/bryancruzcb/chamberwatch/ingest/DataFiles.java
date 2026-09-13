package io.github.bryancruzcb.chamberwatch.ingest;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Collection;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Checks the public data files against the committed MD5 list. Readers take a {@link VerifiedFile}
 * and only {@link #verify} makes one, so no code can read a file that was not checked.
 */
public final class DataFiles {

	private DataFiles() {
	}

	/**
	 * Verifies the named files in a directory.
	 *
	 * @param md5List lines of {@code <md5>  <file name>}, as {@code md5sum} writes them
	 * @return the verified files by name, in the order asked
	 * @throws ChecksumMismatch when a file does not match its listed MD5
	 * @throws IllegalArgumentException when a name is not in the list
	 */
	public static Map<String, VerifiedFile> verify(Path dataDir, Path md5List, Collection<String> fileNames) {
		Map<String, String> expected = readList(md5List);
		Map<String, VerifiedFile> verified = new LinkedHashMap<>();
		for (String name : fileNames) {
			String md5 = expected.get(name);
			if (md5 == null) {
				throw new IllegalArgumentException(name + " is not listed in " + md5List);
			}
			Path file = dataDir.resolve(name);
			String actual = md5Of(file);
			if (!actual.equals(md5)) {
				throw new ChecksumMismatch(file, md5, actual);
			}
			verified.put(name, new VerifiedFile(file, actual, sizeOf(file)));
		}
		return verified;
	}

	private static Map<String, String> readList(Path md5List) {
		Map<String, String> sums = new HashMap<>();
		try {
			for (String line : Files.readAllLines(md5List)) {
				String trimmed = line.strip();
				if (trimmed.isEmpty()) {
					continue;
				}
				String[] parts = trimmed.split("\\s+\\*?", 2);
				if (parts.length != 2 || !parts[0].matches("[0-9a-fA-F]{32}")) {
					throw new IllegalArgumentException("not an md5sum line in " + md5List + ": " + line);
				}
				sums.put(parts[1], parts[0].toLowerCase(Locale.ROOT));
			}
		}
		catch (IOException ex) {
			throw new UncheckedIOException(ex);
		}
		return sums;
	}

	private static String md5Of(Path file) {
		try (InputStream in = Files.newInputStream(file)) {
			MessageDigest digest = MessageDigest.getInstance("MD5");
			byte[] buffer = new byte[64 * 1024];
			for (int read = in.read(buffer); read != -1; read = in.read(buffer)) {
				digest.update(buffer, 0, read);
			}
			return HexFormat.of().formatHex(digest.digest());
		}
		catch (IOException ex) {
			throw new UncheckedIOException(ex);
		}
		catch (NoSuchAlgorithmException ex) {
			throw new IllegalStateException("every Java platform provides MD5", ex);
		}
	}

	private static long sizeOf(Path file) {
		try {
			return Files.size(file);
		}
		catch (IOException ex) {
			throw new UncheckedIOException(ex);
		}
	}

	/** A file whose MD5 matched the list when it was verified. */
	public static final class VerifiedFile {

		private final Path path;

		private final String md5;

		private final long bytes;

		private VerifiedFile(Path path, String md5, long bytes) {
			this.path = path;
			this.md5 = md5;
			this.bytes = bytes;
		}

		public Path path() {
			return path;
		}

		public String md5() {
			return md5;
		}

		public long bytes() {
			return bytes;
		}

	}

	/** Thrown before any data file is read when a checksum does not match. */
	public static final class ChecksumMismatch extends RuntimeException {

		ChecksumMismatch(Path file, String expected, String actual) {
			super(file + ": expected MD5 " + expected + ", got " + actual);
		}

	}

}
