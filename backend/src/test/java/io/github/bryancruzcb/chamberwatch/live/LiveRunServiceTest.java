package io.github.bryancruzcb.chamberwatch.live;

import java.util.Optional;

import io.github.bryancruzcb.chamberwatch.TestcontainersConfiguration;
import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;
import io.github.bryancruzcb.chamberwatch.recipe.EtchRuns;
import io.github.bryancruzcb.chamberwatch.recipe.RawRun;
import io.github.bryancruzcb.chamberwatch.recipe.RunKey;
import io.github.bryancruzcb.chamberwatch.recipe.Source;
import io.github.bryancruzcb.chamberwatch.sim.FaultKind;
import io.github.bryancruzcb.chamberwatch.store.RunStore;
import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

/**
 * The whole live path against a stand-in simulator: a run arrives frame by frame, and comes out stored, aligned
 * and scored under a baseline of its own, with the fault the stream reported beside it.
 */
@SpringBootTest
@Import(TestcontainersConfiguration.class)
class LiveRunServiceTest {

	@Autowired
	private LiveRunService live;

	@Autowired
	private RunStore runs;

	@Autowired
	private JdbcClient jdbc;

	@Test
	void aStreamedWaferIsStoredAlignedAndScoredLikeAnyOther() {
		RunKey key = RunKey.live(7, 1, 1);
		RawRun run = EtchRuns.etch().key(key).build().run();
		Frame.StreamedFault fault = new Frame.StreamedFault(FaultKind.GAS_FLOW_STUCK_LOW,
				ChannelName.of("Gas5Flow"), 187.9, Optional.empty(), 0.36);

		LiveRunService.Recorded recorded;
		try (FakeSimulator simulator = FakeSimulator.streaming(key, run, Optional.of(fault))) {
			recorded = live.record("127.0.0.1", simulator.port());
			assertThat(simulator.failure()).isEmpty();
		}

		assertThat(recorded.key()).isEqualTo(key);
		assertThat(recorded.stored()).isTrue();
		assertThat(recorded.reason()).isEqualTo("COMPLETE");
		assertThat(recorded.samples()).isEqualTo(run.sampleCount());
		assertThat(recorded.alignment()).contains("ALIGNED");

		// stored as a run of its own source, with every sample
		assertThat(runs.exists(key)).isTrue();
		assertThat(count("select count(*) from run r join lot l on l.id = r.lot_id "
				+ "where l.source = 'LIVE' and r.run_key = '" + key.value() + "'")).isEqualTo(1);
		assertThat(count("select count(*) from sample where run_id = " + recorded.id().value()))
			.isEqualTo((long) run.sampleCount() * run.channels().size());

		// the fault the stream reported is beside it
		assertThat(runs.injectedFault(recorded.id())).isPresent();
		assertThat(runs.injectedFault(recorded.id()).orElseThrow().kind()).isEqualTo(FaultKind.GAS_FLOW_STUCK_LOW);
		assertThat(runs.injectedFault(recorded.id()).orElseThrow().startS()).isCloseTo(187.9, within(0.01));

		// and it was banded and scored under a live baseline, not one learned from another generator
		assertThat(count("select count(*) from baseline where source = 'LIVE'")).isPositive();
		assertThat(count("select count(*) from run_assessment a join baseline b on b.id = a.baseline_id "
				+ "where b.source = 'LIVE' and a.run_id = " + recorded.id().value())).isEqualTo(1);
		assertThat(count("select count(*) from current_baseline where source = 'LIVE'")).isEqualTo(1);
	}

	@Test
	void theSameWaferStreamedTwiceIsStoredOnce() {
		RunKey key = RunKey.live(7, 2, 1);
		RawRun run = EtchRuns.etch().key(key).build().run();

		LiveRunService.Recorded first;
		LiveRunService.Recorded second;
		try (FakeSimulator once = FakeSimulator.streaming(key, run, Optional.empty())) {
			first = live.record("127.0.0.1", once.port());
		}
		try (FakeSimulator twice = FakeSimulator.streaming(key, run, Optional.empty())) {
			second = live.record("127.0.0.1", twice.port());
		}

		assertThat(first.stored()).isTrue();
		assertThat(second.stored()).isFalse();
		assertThat(second.id()).isEqualTo(first.id());
		assertThat(count("select count(*) from run where run_key = '" + key.value() + "'")).isEqualTo(1);
	}

	@Test
	void aRunIsNotRecordedFromSomewhereThereIsNoSimulator() {
		org.assertj.core.api.Assertions.assertThatThrownBy(() -> live.record("127.0.0.1", 1))
			.isInstanceOf(java.io.UncheckedIOException.class)
			.hasMessageContaining("cannot reach a chamber simulator");
		assertThat(live.progress()).isEmpty();
	}

	@Test
	void theKeyAndTheSourceComeFromTheStream() {
		RunKey key = RunKey.live(11, 3, 2);

		assertThat(key.value()).isEqualTo("LIVE-s11-L3-W02");
		assertThat(key.source()).isEqualTo(Source.LIVE);
		assertThat(key.seed()).hasValue(11);
	}

	private long count(String sql) {
		return jdbc.sql(sql).query(Long.class).single();
	}

}
