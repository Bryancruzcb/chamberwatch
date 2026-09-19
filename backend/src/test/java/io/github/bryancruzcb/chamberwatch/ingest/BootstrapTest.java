package io.github.bryancruzcb.chamberwatch.ingest;

import java.net.URI;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Supplier;

import io.github.bryancruzcb.chamberwatch.ChamberwatchProperties;
import io.github.bryancruzcb.chamberwatch.health.HealthService;
import io.github.bryancruzcb.chamberwatch.health.RefreshQueue;
import io.github.bryancruzcb.chamberwatch.recipe.Source;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;

import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.boot.test.context.runner.WebApplicationContextRunner;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * What the bootstrap does in each state the database can be in. The ingest, the fetch and simulate-lot are tested on
 * their own; this is the decision between them, so the collaborators are stand-ins.
 */
class BootstrapTest {

	private static final ChamberwatchProperties PROPERTIES = new ChamberwatchProperties(true, true, Path.of("data"),
			Path.of("docs/zenodo17122442.md5"), URI.create("https://zenodo.org/api/records/17122442/files/"));

	private final IngestService ingest = mock(IngestService.class);

	private final SimulateLotService simulateLot = mock(SimulateLotService.class);

	private final HealthService health = mock(HealthService.class);

	private final ZenodoFiles zenodo = mock(ZenodoFiles.class);

	/** Runs the work at once on the caller's thread, as the real queue does on its own. */
	private final RefreshQueue refreshes = mock(RefreshQueue.class);

	private final Bootstrap bootstrap = new Bootstrap(ingest, simulateLot, health, refreshes, PROPERTIES, zenodo);

	@Test
	void onlyAWebServerStartedWithTheSettingBootstraps() {
		ApplicationContextRunner plain = new ApplicationContextRunner().withBean(IngestService.class, () -> ingest)
			.withBean(SimulateLotService.class, () -> simulateLot)
			.withBean(HealthService.class, () -> health)
			.withBean(RefreshQueue.class, () -> refreshes)
			.withBean(ChamberwatchProperties.class, () -> PROPERTIES)
			.withUserConfiguration(Bootstrap.class);
		WebApplicationContextRunner web = new WebApplicationContextRunner().withBean(IngestService.class, () -> ingest)
			.withBean(SimulateLotService.class, () -> simulateLot)
			.withBean(HealthService.class, () -> health)
			.withBean(RefreshQueue.class, () -> refreshes)
			.withBean(ChamberwatchProperties.class, () -> PROPERTIES)
			.withUserConfiguration(Bootstrap.class);

		web.withPropertyValues("chamberwatch.bootstrap=true").run((context) -> assertThat(context).hasSingleBean(Bootstrap.class));
		web.run((context) -> assertThat(context).doesNotHaveBean(Bootstrap.class));
		// the command-line commands start Spring without a web server, and must not bootstrap
		plain.withPropertyValues("chamberwatch.bootstrap=true").run((context) -> assertThat(context).doesNotHaveBean(Bootstrap.class));
	}

	@Test
	void anEmptyDatabaseGetsThePublicFilesTheirIngestAndTheDemoLot() {
		when(zenodo.fetch(PROPERTIES.dataDir(), PROPERTIES.md5List(), IngestService.PUBLIC_FILES))
			.thenReturn(IngestService.PUBLIC_FILES);
		when(ingest.ingestPublic(PROPERTIES.dataDir(), PROPERTIES.md5List())).thenReturn(mock(IngestReport.class));
		when(simulateLot.simulate(7, 901, 10, 10)).thenReturn(mock(SimulateLotReport.class));

		Bootstrap.Done done = bootstrap.run();

		assertThat(done).isEqualTo(new Bootstrap.Done(IngestService.PUBLIC_FILES, true, true));
		// the ingest reads what the fetch wrote, and the demo lot's baseline comes after the public one
		InOrder order = inOrder(zenodo, ingest, simulateLot);
		order.verify(zenodo).fetch(PROPERTIES.dataDir(), PROPERTIES.md5List(), IngestService.PUBLIC_FILES);
		order.verify(ingest).ingestPublic(PROPERTIES.dataDir(), PROPERTIES.md5List());
		order.verify(simulateLot).simulate(7, 901, 10, 10);
	}

	@Test
	void aLoadedDatabaseIsOnlyRefreshedSoARestartWritesNothing() {
		when(ingest.alreadyIngested(PROPERTIES.md5List())).thenReturn(true);
		when(simulateLot.alreadyStored(7, 901, 10, 10)).thenReturn(true);

		Bootstrap.Done done = bootstrap.run();

		assertThat(done).isEqualTo(new Bootstrap.Done(List.of(), false, false));
		verify(zenodo, never()).fetch(any(), any(), any());
		verify(ingest, never()).ingestPublic(any(), any());
		verify(simulateLot, never()).simulate(7, 901, 10, 10);
		verify(health).refresh(Source.PUBLIC);
		verify(health).refresh(Source.SYNTHETIC);
	}

	@Test
	void aFailedAttemptIsTriedAgainAfterEachWaitOnTheRefreshThread() throws InterruptedException {
		when(refreshes.runInTurn(any())).thenAnswer((call) -> call.<Supplier<?>>getArgument(0).get());
		when(ingest.alreadyIngested(PROPERTIES.md5List())).thenReturn(true);
		when(simulateLot.alreadyStored(7, 901, 10, 10)).thenReturn(true);
		when(health.refresh(Source.PUBLIC)).thenThrow(new IllegalStateException("database away"))
			.thenThrow(new IllegalStateException("database away"))
			.thenReturn(null);
		List<Duration> waited = new ArrayList<>();

		assertThat(bootstrap.runUntilDone(List.of(Duration.ofMinutes(1), Duration.ofMinutes(5), Duration.ofMinutes(15)),
				waited::add)).contains(new Bootstrap.Done(List.of(), false, false));
		assertThat(waited).containsExactly(Duration.ofMinutes(1), Duration.ofMinutes(5));
		verify(refreshes, times(3)).runInTurn(any());
	}

	@Test
	void everyAttemptFailingLeavesItToTheNextStart() throws InterruptedException {
		when(refreshes.runInTurn(any())).thenThrow(new IllegalStateException("Zenodo away"));
		List<Duration> waited = new ArrayList<>();

		assertThat(bootstrap.runUntilDone(List.of(Duration.ofMinutes(1)), waited::add)).isEmpty();
		assertThat(waited).containsExactly(Duration.ofMinutes(1));
	}

	@Test
	void aStartAfterACrashInTheDemoLotStoresOnlyTheDemoLot() {
		when(ingest.alreadyIngested(PROPERTIES.md5List())).thenReturn(true);
		when(simulateLot.simulate(7, 901, 10, 10)).thenReturn(mock(SimulateLotReport.class));

		Bootstrap.Done done = bootstrap.run();

		assertThat(done).isEqualTo(new Bootstrap.Done(List.of(), false, true));
		verify(zenodo, never()).fetch(any(), any(), any());
		verify(simulateLot).simulate(7, 901, 10, 10);
	}

}
