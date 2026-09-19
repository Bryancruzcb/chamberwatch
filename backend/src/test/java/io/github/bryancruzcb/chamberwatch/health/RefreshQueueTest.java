package io.github.bryancruzcb.chamberwatch.health;

import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import io.github.bryancruzcb.chamberwatch.detect.Label;
import io.github.bryancruzcb.chamberwatch.health.RefreshQueue.State;
import io.github.bryancruzcb.chamberwatch.recipe.Source;
import io.github.bryancruzcb.chamberwatch.store.RunId;
import io.github.bryancruzcb.chamberwatch.store.RunStore;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** The queue on its own, with the refit held on a latch, so the tests see what a relabel does before it ends. */
class RefreshQueueTest {

	private static final RunId RUN = new RunId(55);

	private static final Refresh FITTED = new Refresh(Source.PUBLIC, Optional.empty(), true, 96, 15, true, 0);

	private final RunStore runs = mock(RunStore.class);

	private final HealthService health = mock(HealthService.class);

	private final RefreshQueue queue = new RefreshQueue(runs, health);

	@AfterEach
	void stop() {
		queue.destroy();
	}

	@Test
	void aRelabelAnswersWhileItsRefitIsStillRunningAndReportsItWhenItEnds() throws InterruptedException {
		CountDownLatch refitting = new CountDownLatch(1);
		CountDownLatch release = new CountDownLatch(1);
		when(runs.relabel(RUN, Label.GOOD)).thenReturn(Optional.of(Source.PUBLIC));
		when(health.refresh(Source.PUBLIC)).thenAnswer((call) -> {
			refitting.countDown();
			release.await();
			return FITTED;
		});

		RefreshQueue.Status queued = queue.relabel(RUN, Label.GOOD).orElseThrow();

		assertThat(queued.state()).isEqualTo(State.RUNNING);
		assertThat(refitting.await(5, TimeUnit.SECONDS)).isTrue();
		assertThat(queue.status(queued.id()).orElseThrow().state()).isEqualTo(State.RUNNING);
		release.countDown();
		RefreshQueue.Status done = finished(queued.id());
		assertThat(done.state()).isEqualTo(State.DONE);
		assertThat(done.refresh()).contains(FITTED);
		InOrder order = inOrder(runs, health);
		order.verify(runs).relabel(RUN, Label.GOOD);
		order.verify(health).refresh(Source.PUBLIC);
	}

	@Test
	void aSecondRelabelQueuesItsOwnRefreshBehindTheFirst() throws InterruptedException {
		CountDownLatch release = new CountDownLatch(1);
		when(runs.relabel(RUN, Label.BAD)).thenReturn(Optional.of(Source.PUBLIC));
		when(runs.relabel(RUN, Label.AUTO)).thenReturn(Optional.of(Source.PUBLIC));
		when(health.refresh(Source.PUBLIC)).thenAnswer((call) -> {
			release.await();
			return FITTED;
		});

		RefreshQueue.Status first = queue.relabel(RUN, Label.BAD).orElseThrow();
		RefreshQueue.Status second = queue.relabel(RUN, Label.AUTO).orElseThrow();

		assertThat(second.id()).isGreaterThan(first.id());
		assertThat(queue.status(second.id()).orElseThrow().state()).isEqualTo(State.RUNNING);
		release.countDown();
		assertThat(finished(first.id()).state()).isEqualTo(State.DONE);
		assertThat(finished(second.id()).state()).isEqualTo(State.DONE);
		verify(health, times(2)).refresh(Source.PUBLIC);
	}

	@Test
	void aRefitThatRunsOutOfMemoryIsReportedAndTheNextRelabelStillRefreshes() throws InterruptedException {
		when(runs.relabel(RUN, Label.GOOD)).thenReturn(Optional.of(Source.PUBLIC));
		when(health.refresh(Source.PUBLIC)).thenThrow(new OutOfMemoryError("Java heap space")).thenReturn(FITTED);

		RefreshQueue.Status failed = finished(queue.relabel(RUN, Label.GOOD).orElseThrow().id());
		RefreshQueue.Status next = finished(queue.relabel(RUN, Label.GOOD).orElseThrow().id());

		assertThat(failed.state()).isEqualTo(State.FAILED);
		assertThat(failed.error()).contains("java.lang.OutOfMemoryError: Java heap space");
		assertThat(next.state()).isEqualTo(State.DONE);
	}

	@Test
	void anUnknownRunQueuesNothing() {
		when(runs.relabel(RUN, Label.GOOD)).thenReturn(Optional.empty());

		assertThat(queue.relabel(RUN, Label.GOOD)).isEmpty();
		verifyNoInteractions(health);
	}

	private RefreshQueue.Status finished(long id) throws InterruptedException {
		for (int attempt = 0; attempt < 500; attempt++) {
			RefreshQueue.Status status = queue.status(id).orElseThrow();
			if (status.state() != State.RUNNING) {
				return status;
			}
			Thread.sleep(10);
		}
		throw new AssertionError("refresh " + id + " was still running after 5 s");
	}

}
