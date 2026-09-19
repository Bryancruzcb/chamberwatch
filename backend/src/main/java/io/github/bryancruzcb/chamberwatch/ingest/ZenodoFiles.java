package io.github.bryancruzcb.chamberwatch.ingest;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * Fetches public data files from a Zenodo record into a directory, each checked against the committed MD5 list.
 * A file already there with the right checksum is kept, so a second fetch downloads nothing. A download lands under
 * a temporary name and takes the file's own name only once its checksum matches, so a crash or a bad download never
 * leaves a file that looks fetched.
 */
public class ZenodoFiles {

	/** The longest one file may take, headers and body together; the largest file is 8.8 MB. */
	static final Duration TIMEOUT = Duration.ofMinutes(5);

	private final URI record;

	private final Duration timeout;

	private final HttpClient http = HttpClient.newBuilder()
		.followRedirects(HttpClient.Redirect.NORMAL)
		.connectTimeout(Duration.ofSeconds(30))
		.build();

	/** @param record the record's file listing, ending in a slash; each file is under {@code <name>/content} */
	public ZenodoFiles(URI record) {
		this(record, TIMEOUT);
	}

	ZenodoFiles(URI record, Duration timeout) {
		this.record = record;
		this.timeout = timeout;
	}

	/**
	 * @return the names it downloaded, in the order asked; empty when every file was already there
	 * @throws DataFiles.ChecksumMismatch when a download does not match its listed MD5; nothing is kept under its name
	 * @throws IllegalArgumentException   when a name is not in the list
	 * @throws UncheckedIOException       when a file cannot be fetched or written
	 */
	public List<String> fetch(Path dir, Path md5List, Collection<String> names) {
		Map<String, String> expected = DataFiles.readList(md5List);
		List<String> downloaded = new ArrayList<>();
		try {
			Files.createDirectories(dir);
			for (String name : names) {
				String md5 = expected.get(name);
				if (md5 == null) {
					throw new IllegalArgumentException(name + " is not listed in " + md5List);
				}
				Path target = dir.resolve(name);
				if (Files.isRegularFile(target) && DataFiles.md5Of(target).equals(md5)) {
					continue;
				}
				Path part = dir.resolve(name + ".part");
				// a download writes over a file without truncating it, so a longer leftover from a crash goes first
				Files.deleteIfExists(part);
				download(record.resolve(name + "/content"), part);
				String actual = DataFiles.md5Of(part);
				if (!actual.equals(md5)) {
					Files.delete(part);
					throw new DataFiles.ChecksumMismatch(target, md5, actual);
				}
				Files.move(part, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
				downloaded.add(name);
			}
		}
		catch (IOException ex) {
			throw new UncheckedIOException(ex);
		}
		return downloaded;
	}

	// the request's own timeout ends once the headers arrive, so the whole download is bounded on its future
	private void download(URI uri, Path to) throws IOException {
		HttpRequest request = HttpRequest.newBuilder(uri).timeout(timeout).GET().build();
		Future<HttpResponse<Path>> pending = http.sendAsync(request, HttpResponse.BodyHandlers.ofFile(to));
		HttpResponse<Path> response;
		try {
			response = pending.get(timeout.toMillis(), TimeUnit.MILLISECONDS);
		}
		catch (TimeoutException ex) {
			pending.cancel(true);
			deleteIfPossible(to);
			throw new IOException("fetching " + uri + " took longer than " + timeout, ex);
		}
		catch (ExecutionException ex) {
			deleteIfPossible(to);
			throw new IOException("fetching " + uri + " failed", ex.getCause());
		}
		catch (InterruptedException ex) {
			pending.cancel(true);
			Thread.currentThread().interrupt();
			throw new IOException("interrupted while fetching " + uri, ex);
		}
		if (response.statusCode() != 200) {
			Files.deleteIfExists(to);
			throw new IOException("GET " + uri + " answered " + response.statusCode());
		}
	}

	/** A cancelled download may still hold its file open; the next fetch removes what is left, so the error that ended it wins. */
	private static void deleteIfPossible(Path file) {
		try {
			Files.deleteIfExists(file);
		}
		catch (IOException ignored) {
			// left for the next fetch
		}
	}

}
