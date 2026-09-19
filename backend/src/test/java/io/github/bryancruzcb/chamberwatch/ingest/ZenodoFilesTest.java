package io.github.bryancruzcb.chamberwatch.ingest;

import java.io.IOException;
import java.io.OutputStream;
import java.io.UncheckedIOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatExceptionOfType;

/** The fetch against a local server that answers like Zenodo: {@code <record>/<name>/content}. */
class ZenodoFilesTest {

	private static final String ONE = "one.txt";

	private static final String TWO = "two.txt";

	@TempDir
	private Path tmp;

	/** What the server answers per file name. */
	private final Map<String, String> served = new ConcurrentHashMap<>(Map.of(ONE, "first file\n", TWO, "second file\n"));

	private final AtomicInteger requests = new AtomicInteger();

	/** Held by the stalling file until the test ends. */
	private final CountDownLatch stalled = new CountDownLatch(1);

	private HttpServer server;

	private Path md5List;

	private ZenodoFiles zenodo;

	@BeforeEach
	void serve() throws IOException {
		server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
		server.createContext("/records/1/files/", (exchange) -> {
			requests.incrementAndGet();
			String path = exchange.getRequestURI().getPath();
			String name = path.substring("/records/1/files/".length(), path.length() - "/content".length());
			if (name.equals("stall.txt")) {
				// the headers promise 1,000 bytes, the body sends ten and then nothing
				exchange.sendResponseHeaders(200, 1000);
				exchange.getResponseBody().write(new byte[10]);
				exchange.getResponseBody().flush();
				try {
					stalled.await(30, TimeUnit.SECONDS);
				}
				catch (InterruptedException ex) {
					Thread.currentThread().interrupt();
				}
				exchange.close();
				return;
			}
			byte[] body = served.getOrDefault(name, "").getBytes(StandardCharsets.UTF_8);
			exchange.sendResponseHeaders(served.containsKey(name) ? 200 : 404, served.containsKey(name) ? body.length : -1);
			try (OutputStream out = exchange.getResponseBody()) {
				out.write(body);
			}
		});
		server.start();
		md5List = tmp.resolve("files.md5");
		Files.writeString(md5List, md5Of("first file\n") + "  " + ONE + "\n" + md5Of("second file\n") + "  " + TWO + "\n");
		zenodo = new ZenodoFiles(URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/records/1/files/"));
	}

	@AfterEach
	void stop() {
		stalled.countDown();
		server.stop(0);
	}

	@Test
	void aSecondFetchFindsEveryFileInPlaceAndDownloadsNothing() throws IOException {
		Path dir = tmp.resolve("data");

		assertThat(zenodo.fetch(dir, md5List, List.of(ONE, TWO))).containsExactly(ONE, TWO);
		assertThat(Files.readString(dir.resolve(TWO))).isEqualTo("second file\n");
		assertThat(zenodo.fetch(dir, md5List, List.of(ONE, TWO))).isEmpty();
		assertThat(requests).hasValue(2);
	}

	@Test
	void aFileThatNoLongerMatchesIsFetchedAgain() throws IOException {
		Path dir = tmp.resolve("data");
		zenodo.fetch(dir, md5List, List.of(ONE, TWO));
		Files.writeString(dir.resolve(ONE), "truncated");

		assertThat(zenodo.fetch(dir, md5List, List.of(ONE, TWO))).containsExactly(ONE);
		assertThat(Files.readString(dir.resolve(ONE))).isEqualTo("first file\n");
	}

	@Test
	void aDownloadThatDoesNotMatchItsChecksumLeavesNothingUnderItsName() throws IOException {
		Path dir = tmp.resolve("data");
		served.put(TWO, "not the second file\n");

		assertThatExceptionOfType(DataFiles.ChecksumMismatch.class).isThrownBy(() -> zenodo.fetch(dir, md5List, List.of(ONE, TWO)));
		assertThat(dir.resolve(ONE)).exists();
		assertThat(dir.resolve(TWO)).doesNotExist();
		assertThat(dir.resolve(TWO + ".part")).doesNotExist();
	}

	@Test
	void aDownloadThatStallsAfterItsHeadersEndsAtTheTimeout() throws IOException {
		Files.writeString(md5List, md5Of("never arrives") + "  stall.txt\n");
		ZenodoFiles impatient = new ZenodoFiles(URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/records/1/files/"),
				Duration.ofSeconds(1));

		assertThatExceptionOfType(UncheckedIOException.class)
			.isThrownBy(() -> impatient.fetch(tmp.resolve("data"), md5List, List.of("stall.txt")))
			.withMessageContaining("took longer than PT1S");
		assertThat(tmp.resolve("data").resolve("stall.txt")).doesNotExist();
	}

	@Test
	void aLongerPartialFileLeftByACrashDoesNotSpoilTheNextDownload() throws IOException {
		Path dir = Files.createDirectories(tmp.resolve("data"));
		Files.writeString(dir.resolve(TWO + ".part"), "a partial file much longer than the second file's body\n");

		assertThat(zenodo.fetch(dir, md5List, List.of(TWO))).containsExactly(TWO);
		assertThat(Files.readString(dir.resolve(TWO))).isEqualTo("second file\n");
	}

	@Test
	void aFileTheServerDoesNotHaveIsAnError() {
		served.remove(TWO);

		assertThatExceptionOfType(UncheckedIOException.class).isThrownBy(() -> zenodo.fetch(tmp.resolve("data"), md5List, List.of(TWO)))
			.withMessageContaining("answered 404");
	}

	private String md5Of(String content) throws IOException {
		Path file = Files.createTempFile(tmp, "md5", ".txt");
		Files.writeString(file, content);
		return DataFiles.md5Of(file);
	}

}
