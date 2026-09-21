package io.github.bryancruzcb.chamberwatch.live;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.UncheckedIOException;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicReference;

import io.github.bryancruzcb.chamberwatch.health.HealthService;
import io.github.bryancruzcb.chamberwatch.recipe.AlignmentResult;
import io.github.bryancruzcb.chamberwatch.recipe.Aligner;
import io.github.bryancruzcb.chamberwatch.recipe.RawRun;
import io.github.bryancruzcb.chamberwatch.recipe.RunKey;
import io.github.bryancruzcb.chamberwatch.recipe.Source;
import io.github.bryancruzcb.chamberwatch.sim.FaultPlan;
import io.github.bryancruzcb.chamberwatch.sim.InjectedFault;
import io.github.bryancruzcb.chamberwatch.store.LotRecord;
import io.github.bryancruzcb.chamberwatch.store.LotRef;
import io.github.bryancruzcb.chamberwatch.store.RunId;
import io.github.bryancruzcb.chamberwatch.store.RunStore;

import org.springframework.stereotype.Service;

/**
 * Records a wafer as the chamber simulator etches it, and stores it when the run ends.
 *
 * <p>One connection at a time, because there is one chamber. The frames are read on the calling thread, which
 * for the HTTP API is a thread of the session's own, and nothing is written to the database until the simulator
 * says the run is over: a half-streamed run is not a run. When it ends, the samples go through exactly the path
 * every other run takes, {@link Aligner} then {@link RunStore#insertIfAbsent} then a refresh, so a live wafer is
 * aligned, stored, banded and scored by the same code as a public one.
 */
@Service
public class LiveRunService {

	/** How long to wait for the next frame before giving up on the simulator. */
	static final Duration FRAME_TIMEOUT = Duration.ofSeconds(30);

	/** One sample of the record, the shortest duration a fault can be given. */
	private static final double RECORD_STEP_S = 0.2;

	private final RunStore runs;

	private final HealthService health;

	private final AtomicReference<Session> session = new AtomicReference<>();

	/** One recording at a time, on a thread of its own so a caller never waits eleven minutes for a run. */
	private final ExecutorService recorder = Executors.newSingleThreadExecutor((task) -> {
		Thread thread = new Thread(task, "live-run");
		thread.setDaemon(true);
		return thread;
	});

	/** What the last recording came to, kept until another one starts, for a page that asks after the fact. */
	private final AtomicReference<Finished> last = new AtomicReference<>();

	public LiveRunService(RunStore runs, HealthService health) {
		this.runs = runs;
		this.health = health;
	}

	/**
	 * How a recording ended: the run it stored, or why it did not.
	 *
	 * @param failure the message of what went wrong, empty when the run was recorded
	 */
	public record Finished(Optional<Recorded> recorded, Optional<String> failure) {
	}

	/** What a finished stream came to. */
	public record Recorded(RunKey key, RunId id, int samples, boolean stored, String reason,
			Optional<Frame.StreamedFault> fault, Optional<String> alignment) {
	}

	/** What is happening now, for a page that polls. */
	public record Progress(RunKey key, String state, int cycle, int samples, double timeS, boolean running) {
	}

	/** The connection being recorded, if there is one. */
	private static final class Session {

		private final Socket socket;

		private volatile Progress progress;

		private Session(Socket socket, Progress progress) {
			this.socket = socket;
			this.progress = progress;
		}

	}

	public Optional<Progress> progress() {
		Session current = session.get();
		return (current == null || current.progress == null) ? Optional.empty() : Optional.of(current.progress);
	}

	/** Whether a run is being recorded right now. */
	public boolean recording() {
		return session.get() != null;
	}

	/** What the last recording came to, empty until one has finished since the app started. */
	public Optional<Finished> last() {
		return Optional.ofNullable(last.get());
	}

	/**
	 * Starts recording on a thread of its own and returns at once. The page watches {@link #progress()} and reads
	 * {@link #last()} when it stops.
	 *
	 * @throws IllegalStateException when a run is already being recorded
	 */
	public void start(String host, int port) {
		if (recording()) {
			throw new IllegalStateException("a live run is already being recorded");
		}
		last.set(null);
		recorder.execute(() -> {
			try {
				last.set(new Finished(Optional.of(record(host, port)), Optional.empty()));
			}
			catch (RuntimeException ex) {
				last.set(new Finished(Optional.empty(), Optional.of(String.valueOf(ex.getMessage()))));
			}
		});
	}

	/** Stops a recording by closing the connection; the simulator is left to finish on its own. */
	public void stop() {
		Session current = session.get();
		if (current != null) {
			closeQuietly(current.socket);
		}
	}

	/**
	 * Connects to a running simulator, records the wafer it is etching, and stores it when it ends. Blocks until
	 * the run is over.
	 *
	 * @throws IllegalStateException when a run is already being recorded, or the stream ends without a run
	 * @throws UncheckedIOException  when the connection fails
	 */
	public Recorded record(String host, int port) {
		Socket socket = new Socket();
		try {
			socket.connect(new InetSocketAddress(host, port), (int) FRAME_TIMEOUT.toMillis());
			socket.setSoTimeout((int) FRAME_TIMEOUT.toMillis());
		}
		catch (IOException ex) {
			closeQuietly(socket);
			throw new UncheckedIOException("cannot reach a chamber simulator at " + host + ":" + port, ex);
		}
		Session started = new Session(socket, null);
		if (!session.compareAndSet(null, started)) {
			closeQuietly(socket);
			throw new IllegalStateException("a live run is already being recorded");
		}
		try {
			return read(started);
		}
		finally {
			session.set(null);
			closeQuietly(socket);
		}
	}

	/** Sends a command to the running simulator. */
	public void send(String command) {
		Session current = session.get();
		if (current == null) {
			throw new IllegalStateException("no live run is being recorded");
		}
		try {
			OutputStream out = current.socket.getOutputStream();
			out.write((command + "\n").getBytes(StandardCharsets.UTF_8));
			out.flush();
		}
		catch (IOException ex) {
			throw new UncheckedIOException("cannot send to the simulator", ex);
		}
	}

	private Recorded read(Session current) {
		LiveRun run = null;
		Frame.Hello hello = null;
		List<Frame.Ack> acks = new ArrayList<>();
		try (BufferedReader lines = new BufferedReader(
				new InputStreamReader(current.socket.getInputStream(), StandardCharsets.UTF_8))) {
			String line;
			while ((line = lines.readLine()) != null) {
				if (line.isBlank()) {
					continue;
				}
				Frame frame = FrameCodec.parse(line);
				switch (frame) {
					case Frame.Hello start -> {
						hello = start;
						run = new LiveRun(start);
						current.progress = new Progress(start.key(), "IDLE", 0, 0, 0, true);
					}
					case Frame.Sample sample -> {
						if (run == null) {
							throw new IllegalStateException("a sample arrived before the hello");
						}
						run.add(sample);
						current.progress = new Progress(run.key(), sample.state(), sample.cycle(), run.samples(),
								sample.timeS(), true);
					}
					case Frame.Ack ack -> acks.add(ack);
					case Frame.End end -> {
						if (run == null || hello == null) {
							throw new IllegalStateException("the stream ended before it began");
						}
						current.progress = new Progress(run.key(), "END", current.progress.cycle(), run.samples(),
								current.progress.timeS(), false);
						return store(run, hello, end);
					}
					case Frame.Failure failure ->
						throw new IllegalStateException("the simulator refused: " + failure.reason());
					case Frame.Unknown ignored -> {
						/* a newer simulator may send frames this reader does not know */
					}
				}
			}
		}
		catch (IOException ex) {
			throw new UncheckedIOException("the simulator stopped sending", ex);
		}
		throw new IllegalStateException("the simulator closed without ending the run");
	}

	private Recorded store(LiveRun run, Frame.Hello hello, Frame.End end) {
		RawRun raw = run.finish();
		AlignmentResult result = Aligner.STANDARD.align(raw);
		LotRef lot = runs.upsertLot(new LotRecord(Source.LIVE, hello.lot(), Optional.empty(), Optional.empty()));
		Optional<InjectedFault> fault = end.fault().map((streamed) -> injected(streamed, raw));
		Optional<RunId> inserted = runs.insertIfAbsent(raw, result, lot, fault);
		RunId id = inserted.orElseGet(() -> runs.id(raw.key())
			.orElseThrow(() -> new IllegalStateException(raw.key().value() + " was neither stored nor found")));
		if (inserted.isPresent()) {
			health.refresh(Source.LIVE);
		}
		String alignment = switch (result) {
			case AlignmentResult.Aligned aligned -> aligned.run().report().status().name();
			case AlignmentResult.Failed failed -> "FAILED";
		};
		return new Recorded(raw.key(), id, run.samples(), inserted.isPresent(), end.reason(), end.fault(),
				Optional.of(alignment));
	}

	/**
	 * The fault the simulator reported, in the run's own time, as the store records one. A fault the stream
	 * reports with no duration ran to the end of the record, so here it takes the length that says so: a plan
	 * carries a duration, not an absence of one.
	 */
	private InjectedFault injected(Frame.StreamedFault streamed, RawRun raw) {
		double lastSample = raw.time(raw.sampleCount() - 1);
		double durationS = streamed.durationS().orElse(Math.max(lastSample - streamed.startS(), RECORD_STEP_S));
		double endS = Math.min(streamed.startS() + durationS, lastSample);
		FaultPlan plan = new FaultPlan(streamed.kind(), streamed.channel(), streamed.startS(), durationS,
				streamed.magnitude());
		return new InjectedFault(plan, streamed.startS(), endS);
	}

	private static void closeQuietly(Socket socket) {
		try {
			socket.close();
		}
		catch (IOException ignored) {
			/* the run is over either way */
		}
	}

}
