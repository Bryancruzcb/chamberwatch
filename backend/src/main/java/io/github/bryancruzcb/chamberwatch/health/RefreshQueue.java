package io.github.bryancruzcb.chamberwatch.health;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Supplier;

import io.github.bryancruzcb.chamberwatch.detect.Label;
import io.github.bryancruzcb.chamberwatch.recipe.Source;
import io.github.bryancruzcb.chamberwatch.store.RunId;
import io.github.bryancruzcb.chamberwatch.store.RunStore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.springframework.beans.factory.DisposableBean;
import org.springframework.stereotype.Service;

/**
 * Runs the refreshes that relabels ask for, one at a time on a thread of their own, so a relabel answers at once
 * and a refit that takes seconds does not hold the request.
 *
 * <p>One at a time keeps two fits of a source from racing to store the same baseline, and a small host from
 * holding two fits in memory. A relabel that lands while an earlier refresh runs gets a refresh of its own, queued
 * behind it, which reads the newer label; the compare-and-set on the current baseline settles the rest. A refresh
 * lost to a crash or a restart is redone by the next relabel, ingest or simulate-lot, because a refresh converges
 * from any state.
 *
 * <p>The same thread runs the bootstrap's loads ({@link #runInTurn}), so in the server process one thread at a time
 * writes baselines and assessments: a relabel's refresh never reads a roster that a load is still filling, and
 * never finishes after the load's own refresh with an older view of the runs.
 */
@Service
public class RefreshQueue implements DisposableBean {

	/** Refreshes remembered for their status, the oldest forgotten first. */
	public static final int REMEMBERED = 200;

	private static final Logger log = LoggerFactory.getLogger(RefreshQueue.class);

	private final RunStore runs;

	private final HealthService health;

	private final ExecutorService worker = Executors.newSingleThreadExecutor((task) -> {
		Thread thread = new Thread(task, "refresh");
		thread.setDaemon(true);
		return thread;
	});

	private final AtomicLong ids = new AtomicLong();

	private final Map<Long, Status> statuses = new LinkedHashMap<>() {

		@Override
		protected boolean removeEldestEntry(Map.Entry<Long, Status> eldest) {
			return size() > REMEMBERED;
		}

	};

	public RefreshQueue(RunStore runs, HealthService health) {
		this.runs = runs;
		this.health = health;
	}

	public enum State {

		/** Queued behind another refresh, or working. */
		RUNNING,

		DONE,

		/** It threw. The label stays, and the next relabel, ingest or simulate-lot refreshes the source again. */
		FAILED

	}

	/**
	 * One refresh as it stands.
	 *
	 * @param refresh what it did, once it is {@code DONE}
	 * @param error   why it failed, once it {@code FAILED}
	 */
	public record Status(long id, Source source, State state, Optional<Refresh> refresh, Optional<String> error) {
	}

	/**
	 * Records the label at once and queues a refresh of the run's source.
	 *
	 * @return the queued refresh, or empty when no run has that id
	 */
	public Optional<Status> relabel(RunId run, Label label) {
		return runs.relabel(run, label).map(this::submit);
	}

	/**
	 * Runs work on the refresh thread, after the refreshes queued before it and before those queued after, and
	 * waits for it. Must not be called from work already on that thread, which would wait for itself.
	 *
	 * @return what the work returned
	 * @throws RuntimeException what the work threw, or an {@link IllegalStateException} when the wait was
	 *                          interrupted, in which case the work is cancelled
	 */
	public <T> T runInTurn(Supplier<T> work) {
		Future<T> result = worker.submit(work::get);
		try {
			return result.get();
		}
		catch (ExecutionException ex) {
			if (ex.getCause() instanceof RuntimeException runtime) {
				throw runtime;
			}
			if (ex.getCause() instanceof Error error) {
				throw error;
			}
			throw new IllegalStateException(ex.getCause());
		}
		catch (InterruptedException ex) {
			Thread.currentThread().interrupt();
			result.cancel(true);
			throw new IllegalStateException("interrupted while waiting for work on the refresh thread", ex);
		}
	}

	/** @return the refresh, or empty when no refresh had that id since the app started, or too many came after it */
	public Optional<Status> status(long id) {
		synchronized (statuses) {
			return Optional.ofNullable(statuses.get(id));
		}
	}

	private Status submit(Source source) {
		long id = ids.incrementAndGet();
		Status running = new Status(id, source, State.RUNNING, Optional.empty(), Optional.empty());
		record(running);
		worker.execute(() -> {
			try {
				record(new Status(id, source, State.DONE, Optional.of(health.refresh(source)), Optional.empty()));
			}
			catch (RuntimeException | Error ex) {
				// an out-of-memory error on a small host is the likeliest failure, and the page must not wait forever
				log.error("refresh {} of {} failed", id, source, ex);
				record(new Status(id, source, State.FAILED, Optional.empty(), Optional.of(String.valueOf(ex))));
				if (ex instanceof Error error) {
					throw error;
				}
			}
		});
		return running;
	}

	private void record(Status status) {
		synchronized (statuses) {
			statuses.put(status.id(), status);
		}
	}

	@Override
	public void destroy() {
		worker.shutdownNow();
	}

}
