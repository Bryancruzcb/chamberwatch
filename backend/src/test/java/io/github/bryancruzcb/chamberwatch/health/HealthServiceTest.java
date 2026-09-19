package io.github.bryancruzcb.chamberwatch.health;

import java.util.Optional;

import io.github.bryancruzcb.chamberwatch.TestcontainersConfiguration;
import io.github.bryancruzcb.chamberwatch.recipe.Aligner;
import io.github.bryancruzcb.chamberwatch.recipe.EtchRuns;
import io.github.bryancruzcb.chamberwatch.recipe.RawRun;
import io.github.bryancruzcb.chamberwatch.recipe.RunKey;
import io.github.bryancruzcb.chamberwatch.recipe.Source;
import io.github.bryancruzcb.chamberwatch.store.BaselineRef;
import io.github.bryancruzcb.chamberwatch.store.LotRecord;
import io.github.bryancruzcb.chamberwatch.store.LotRef;
import io.github.bryancruzcb.chamberwatch.store.RunStore;
import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

import static org.assertj.core.api.Assertions.assertThat;

/** Other tests store synthetic runs in the same database, so these assertions hold whatever else is there. */
@SpringBootTest
@Import(TestcontainersConfiguration.class)
class HealthServiceTest {

	@Autowired
	private RunStore runs;

	@Autowired
	private HealthService health;

	@Autowired
	private JdbcClient jdbc;

	@Test
	void aRefreshScoresEveryRunAndASecondRefreshWritesNothing() {
		LotRef lot = runs.upsertLot(new LotRecord(Source.SYNTHETIC, 940, Optional.empty(), Optional.empty()));
		for (int position = 1; position <= 4; position++) {
			store(lot, EtchRuns.etch().key(RunKey.simulated(2, 940, position)));
		}
		RunKey faulted = RunKey.simulated(2, 940, 5);
		store(lot, EtchRuns.etch().key(faulted).pressureOffsetFrom(60, 0.1f));

		Refresh first = health.refresh(Source.SYNTHETIC);
		long rowsAfterFirst = derivedRows();
		Refresh second = health.refresh(Source.SYNTHETIC);

		BaselineRef baseline = first.baseline().orElseThrow();
		assertThat(first.fitted()).isTrue();
		assertThat(first.current()).isTrue();
		assertThat(first.scored()).isGreaterThanOrEqualTo(5);
		assertThat(unassessedUnderCurrentBaseline()).isZero();
		assertThat(firstChannel(baseline, faulted)).isEqualTo("Pressure");
		assertThat(second.baseline()).contains(baseline);
		assertThat(second.fitted()).isFalse();
		assertThat(second.scored()).isZero();
		assertThat(second.current()).isTrue();
		assertThat(derivedRows()).isEqualTo(rowsAfterFirst);
	}

	private void store(LotRef lot, EtchRuns.Builder builder) {
		RawRun raw = builder.build().run();
		runs.insertIfAbsent(raw, Aligner.STANDARD.align(raw), lot, Optional.empty()).orElseThrow();
	}

	private long unassessedUnderCurrentBaseline() {
		return jdbc.sql("""
				select count(*)
				from run r
				join lot l on l.id = r.lot_id
				where l.source = 'SYNTHETIC'
				  and r.alignment_status <> 'FAILED'
				  and not exists (select 1
				                  from run_assessment a
				                  join current_baseline c on c.baseline_id = a.baseline_id
				                  where c.source = 'SYNTHETIC' and a.run_id = r.id)""")
			.query(Long.class)
			.single();
	}

	private String firstChannel(BaselineRef baseline, RunKey key) {
		return jdbc.sql("""
				select c.name
				from run_assessment a
				join run r on r.id = a.run_id
				join channel c on c.id = a.first_channel_id
				where a.baseline_id = :baseline and r.run_key = :key""")
			.param("baseline", baseline.id())
			.param("key", key.value())
			.query(String.class)
			.single();
	}

	private long derivedRows() {
		return jdbc.sql("""
				select (select count(*) from baseline) + (select count(*) from current_baseline)
				     + (select count(*) from baseline_good_run) + (select count(*) from baseline_channel)
				     + (select count(*) from band) + (select count(*) from summary_band)
				     + (select count(*) from run_assessment) + (select count(*) from channel_verdict)
				     + (select count(*) from excursion)""")
			.query(Long.class)
			.single();
	}

}
