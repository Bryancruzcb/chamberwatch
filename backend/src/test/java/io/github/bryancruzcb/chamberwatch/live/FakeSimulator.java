package io.github.bryancruzcb.chamberwatch.live;

import java.io.IOException;
import java.io.OutputStream;
import java.io.UncheckedIOException;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Optional;

import io.github.bryancruzcb.chamberwatch.recipe.RawRun;
import io.github.bryancruzcb.chamberwatch.recipe.RunKey;

/**
 * A stand-in for the C simulator: it streams a run that was generated in Java, frame for frame, in the wire
 * format the real program uses. It lets the recording path be tested without a C compiler, while
 * {@code SimulatorBinaryIT} checks the same path against the real binary where one exists.
 */
final class FakeSimulator implements AutoCloseable {

	private final ServerSocket listener;

	private final Thread thread;

	private volatile IOException failure;

	private FakeSimulator(ServerSocket listener, Thread thread) {
		this.listener = listener;
		this.thread = thread;
	}

	/** Starts a server that streams this run once, then closes. */
	static FakeSimulator streaming(RunKey key, RawRun run, Optional<Frame.StreamedFault> fault) {
		try {
			ServerSocket listener = new ServerSocket(0);
			FakeSimulator[] holder = new FakeSimulator[1];
			Thread thread = new Thread(() -> {
				try (Socket client = listener.accept(); OutputStream out = client.getOutputStream()) {
					write(out, hello(key, run));
					for (int sample = 0; sample < run.sampleCount(); sample++) {
						write(out, sample(run, sample));
					}
					write(out, end(run.sampleCount(), fault));
				}
				catch (IOException ex) {
					if (holder[0] != null) {
						holder[0].failure = ex;
					}
				}
			}, "fake-simulator");
			FakeSimulator simulator = new FakeSimulator(listener, thread);
			holder[0] = simulator;
			thread.setDaemon(true);
			thread.start();
			return simulator;
		}
		catch (IOException ex) {
			throw new UncheckedIOException(ex);
		}
	}

	int port() {
		return listener.getLocalPort();
	}

	Optional<IOException> failure() {
		return Optional.ofNullable(failure);
	}

	private static void write(OutputStream out, String line) throws IOException {
		out.write((line + "\n").getBytes(StandardCharsets.UTF_8));
		out.flush();
	}

	private static String hello(RunKey key, RawRun run) {
		StringBuilder text = new StringBuilder(String.format(Locale.ROOT,
				"{\"type\":\"hello\",\"protocol\":1,\"seed\":%d,\"lot\":%d,\"wafer\":%d,\"run\":\"%s\","
						+ "\"period_s\":0.2,\"channels\":[",
				key.seed().orElseThrow(), lotOf(key), key.positionInLot(), key.value()));
		for (int channel = 0; channel < run.channels().size(); channel++) {
			text.append(channel > 0 ? "," : "").append('"').append(run.channels().name(channel).value()).append('"');
		}
		return text.append("]}").toString();
	}

	private static String sample(RawRun run, int sample) {
		StringBuilder text = new StringBuilder(String.format(Locale.ROOT,
				"{\"type\":\"sample\",\"tick\":%d,\"t\":%.3f,\"state\":\"ETCH\",\"cycle\":0,\"v\":[", sample + 1,
				run.time(sample)));
		for (int channel = 0; channel < run.channels().size(); channel++) {
			text.append(channel > 0 ? "," : "").append(String.format(Locale.ROOT, "%.4f", run.value(channel, sample)));
		}
		return text.append("]}").toString();
	}

	private static String end(int samples, Optional<Frame.StreamedFault> fault) {
		StringBuilder text = new StringBuilder(
				String.format(Locale.ROOT, "{\"type\":\"end\",\"reason\":\"COMPLETE\",\"samples\":%d", samples));
		fault.ifPresent((injected) -> text.append(String.format(Locale.ROOT,
				",\"fault\":{\"kind\":\"%s\",\"channel\":\"%s\",\"start_s\":%.3f,\"duration_s\":%s,\"magnitude\":%.4f}",
				injected.kind().name(), injected.channel().value(), injected.startS(),
				injected.durationS().map((duration) -> String.format(Locale.ROOT, "%.3f", duration)).orElse("null"),
				injected.magnitude())));
		return text.append('}').toString();
	}

	/** The lot a live key names, which the key itself does not expose. */
	private static int lotOf(RunKey key) {
		String value = key.value();
		return Integer.parseInt(value.substring(value.indexOf("-L") + 2, value.indexOf("-W")));
	}

	@Override
	public void close() {
		try {
			listener.close();
		}
		catch (IOException ignored) {
			/* the test is over either way */
		}
		thread.interrupt();
	}

}
