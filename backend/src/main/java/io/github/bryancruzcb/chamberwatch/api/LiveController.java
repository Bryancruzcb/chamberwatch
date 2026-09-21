package io.github.bryancruzcb.chamberwatch.api;

import java.io.UncheckedIOException;
import java.util.Optional;

import io.github.bryancruzcb.chamberwatch.ChamberwatchProperties;
import io.github.bryancruzcb.chamberwatch.live.FrameCodec;
import io.github.bryancruzcb.chamberwatch.live.LiveRunService;
import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;
import io.github.bryancruzcb.chamberwatch.sim.FaultKind;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Watching a wafer being etched: start a recording against a running chamber simulator, follow it while it
 * streams, put a fault into it, and read what it came to when it ends.
 *
 * <p>Starting one writes runs to the database, so a read-only ChamberWatch refuses it exactly as it refuses a
 * relabel. The demo never has a simulator to reach anyway.
 */
@RestController
@RequestMapping("/api/live")
class LiveController {

	private final LiveRunService live;

	private final ChamberwatchProperties properties;

	LiveController(LiveRunService live, ChamberwatchProperties properties) {
		this.live = live;
		this.properties = properties;
	}

	/** Where the chamber simulator is listening. */
	record Start(String host, Integer port) {
	}

	/**
	 * A fault to put into the wafer being etched.
	 *
	 * @param startS    when it should begin, in the run's own seconds; the simulator refuses a moment already past
	 * @param durationS how long it lasts, or null to last to the end of the etch
	 */
	record Inject(FaultKind kind, String channel, Double startS, Double durationS, Double magnitude) {
	}

	/**
	 * What the page shows.
	 *
	 * @param recording whether a wafer is being streamed right now
	 * @param run       the run's key once the hello has arrived
	 * @param stored    the run this recording stored, once it ended
	 * @param failure   why the last recording stopped, when it did not end with a run
	 */
	record SessionView(boolean recording, String run, String state, int cycle, int samples, double timeS,
			StoredView stored, String failure) {
	}

	record StoredView(String run, int runId, int samples, String reason, String alignment, String faultKind,
			String faultChannel) {
	}

	@GetMapping("/session")
	SessionView session() {
		Optional<LiveRunService.Progress> progress = live.progress();
		Optional<LiveRunService.Finished> finished = live.last();
		Optional<LiveRunService.Recorded> recorded = finished.flatMap(LiveRunService.Finished::recorded);
		return new SessionView(live.recording(), progress.map((at) -> at.key().value()).orElse(null),
				progress.map(LiveRunService.Progress::state).orElse(null),
				progress.map(LiveRunService.Progress::cycle).orElse(0),
				progress.map(LiveRunService.Progress::samples).orElse(0),
				progress.map(LiveRunService.Progress::timeS).orElse(0.0),
				recorded.map(LiveController::stored).orElse(null),
				finished.flatMap(LiveRunService.Finished::failure).orElse(null));
	}

	@PostMapping("/start")
	ResponseEntity<SessionView> start(@RequestBody Start start) {
		refuseWhenReadOnly();
		String host = (start.host() == null || start.host().isBlank()) ? "127.0.0.1" : start.host().strip();
		int port = (start.port() == null) ? 5610 : start.port();
		if (port < 1 || port > 65535) {
			throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "not a port: " + port);
		}
		try {
			live.start(host, port);
		}
		catch (IllegalStateException ex) {
			throw new ResponseStatusException(HttpStatus.CONFLICT, ex.getMessage());
		}
		return ResponseEntity.accepted().body(session());
	}

	@PostMapping("/inject")
	SessionView inject(@RequestBody Inject inject) {
		refuseWhenReadOnly();
		if (inject.kind() == null || inject.channel() == null || inject.startS() == null) {
			throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "a fault needs a kind, a channel and a start");
		}
		send(FrameCodec.inject(inject.kind(), ChannelName.of(inject.channel()), inject.startS(),
				Optional.ofNullable(inject.durationS()), (inject.magnitude() == null) ? 0.5 : inject.magnitude()));
		return session();
	}

	@DeleteMapping("/session")
	SessionView stop() {
		refuseWhenReadOnly();
		live.stop();
		return session();
	}

	private void send(String command) {
		try {
			live.send(command);
		}
		catch (IllegalStateException ex) {
			throw new ResponseStatusException(HttpStatus.CONFLICT, "no wafer is being etched");
		}
		catch (UncheckedIOException ex) {
			throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "the simulator stopped listening");
		}
	}

	private void refuseWhenReadOnly() {
		if (properties.readOnly()) {
			throw new ResponseStatusException(HttpStatus.FORBIDDEN,
					"this ChamberWatch is read-only, so it does not record live runs");
		}
	}

	private static StoredView stored(LiveRunService.Recorded recorded) {
		return new StoredView(recorded.key().value(), recorded.id().value(), recorded.samples(), recorded.reason(),
				recorded.alignment().orElse(null),
				recorded.fault().map((fault) -> fault.kind().name()).orElse(null),
				recorded.fault().map((fault) -> fault.channel().value()).orElse(null));
	}

}
