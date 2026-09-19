package io.github.bryancruzcb.chamberwatch.ingest;

import java.time.Duration;
import java.util.List;
import java.util.Optional;

import io.github.bryancruzcb.chamberwatch.ChamberwatchProperties;
import io.github.bryancruzcb.chamberwatch.health.HealthService;
import io.github.bryancruzcb.chamberwatch.health.RefreshQueue;
import io.github.bryancruzcb.chamberwatch.recipe.Source;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBooleanProperty;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * Fills an empty database once the web server is up, when it starts with {@code chamberwatch.bootstrap=true}: the
 * public files from Zenodo, their ingest, then the simulated demo lot. It does only what is missing, on a thread of
 * its own so the server answers meanwhile, and a source it finds loaded gets a refresh, which writes nothing when its
 * baseline is in place. So a restart with the data loaded reads a few rows and returns, and a start after a crash
 * picks up where the last one stopped, because the ingest and simulate-lot are themselves safe to rerun.
 *
 * <p>Each attempt runs on the relabel queue's thread ({@link RefreshQueue#runInTurn}), so a relabel's refresh waits
 * for a load to end and never overlaps it, in time or in memory. A failed attempt, most often Zenodo or the network,
 * is tried again after the waits in {@link #RETRY_AFTER}; after the last one the next start tries again.
 */
@Component
@ConditionalOnWebApplication
@ConditionalOnBooleanProperty("chamberwatch.bootstrap")
class Bootstrap {

	/** The demo lot the README describes: seed 7, lot 901 of 10 wafers, after 10 training lots. */
	static final long SEED = 7;

	static final int LOT = 901;

	static final int WAFERS = 10;

	static final int TRAINING_LOTS = 10;

	/** The waits before each new attempt after a failure. */
	static final List<Duration> RETRY_AFTER = List.of(Duration.ofMinutes(1), Duration.ofMinutes(5), Duration.ofMinutes(15),
			Duration.ofMinutes(60));

	private static final Logger log = LoggerFactory.getLogger(Bootstrap.class);

	private final IngestService ingest;

	private final SimulateLotService simulateLot;

	private final HealthService health;

	private final RefreshQueue refreshes;

	private final ChamberwatchProperties properties;

	private final ZenodoFiles zenodo;

	@Autowired
	Bootstrap(IngestService ingest, SimulateLotService simulateLot, HealthService health, RefreshQueue refreshes,
			ChamberwatchProperties properties) {
		this(ingest, simulateLot, health, refreshes, properties, new ZenodoFiles(properties.zenodo()));
	}

	Bootstrap(IngestService ingest, SimulateLotService simulateLot, HealthService health, RefreshQueue refreshes,
			ChamberwatchProperties properties, ZenodoFiles zenodo) {
		this.ingest = ingest;
		this.simulateLot = simulateLot;
		this.health = health;
		this.refreshes = refreshes;
		this.properties = properties;
		this.zenodo = zenodo;
	}

	/** Waits for a while; the tests pass one that returns at once. */
	@FunctionalInterface
	interface Pause {

		void pause(Duration duration) throws InterruptedException;

	}

	/**
	 * What one bootstrap did.
	 *
	 * @param downloaded the public files it fetched
	 * @param ingested   whether it ran the ingest
	 * @param simulated  whether it stored the demo lot
	 */
	record Done(List<String> downloaded, boolean ingested, boolean simulated) {
	}

	@EventListener(ApplicationReadyEvent.class)
	void start() {
		Thread.ofPlatform().name("bootstrap").daemon(true).start(() -> {
			try {
				runUntilDone(RETRY_AFTER, Thread::sleep).ifPresent((done) -> log.info(
						"bootstrap done: downloaded {}, ingested {}, simulated {}", done.downloaded(), done.ingested(),
						done.simulated()));
			}
			catch (InterruptedException ex) {
				Thread.currentThread().interrupt();
			}
		});
	}

	/**
	 * Tries once, then once more after each wait while attempts fail.
	 *
	 * @return what the attempt that succeeded did, or empty when every attempt failed
	 */
	Optional<Done> runUntilDone(List<Duration> retryAfter, Pause pause) throws InterruptedException {
		for (int attempt = 0; attempt <= retryAfter.size(); attempt++) {
			if (attempt > 0) {
				pause.pause(retryAfter.get(attempt - 1));
			}
			try {
				return Optional.of(refreshes.runInTurn(this::run));
			}
			catch (RuntimeException ex) {
				boolean last = attempt == retryAfter.size();
				log.error(last ? "bootstrap failed; the next start picks up where it stopped"
						: "bootstrap failed; trying again in " + retryAfter.get(attempt), ex);
			}
		}
		return Optional.empty();
	}

	Done run() {
		List<String> downloaded = List.of();
		boolean ingested = false;
		if (ingest.alreadyIngested(properties.md5List())) {
			health.refresh(Source.PUBLIC);
		}
		else {
			log.info("bootstrap: fetching the public files into {}", properties.dataDir());
			downloaded = zenodo.fetch(properties.dataDir(), properties.md5List(), IngestService.PUBLIC_FILES);
			log.info("bootstrap: ingesting the public wafers");
			log.info("bootstrap: {}", ingest.ingestPublic(properties.dataDir(), properties.md5List()).describe());
			ingested = true;
		}
		boolean simulated = false;
		if (simulateLot.alreadyStored(SEED, LOT, WAFERS, TRAINING_LOTS)) {
			health.refresh(Source.SYNTHETIC);
		}
		else {
			log.info("bootstrap: storing the simulated demo lot {}", LOT);
			log.info("bootstrap: {}", simulateLot.simulate(SEED, LOT, WAFERS, TRAINING_LOTS).describe());
			simulated = true;
		}
		return new Done(downloaded, ingested, simulated);
	}

}
