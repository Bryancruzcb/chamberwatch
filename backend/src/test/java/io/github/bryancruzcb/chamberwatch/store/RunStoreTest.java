package io.github.bryancruzcb.chamberwatch.store;

import java.util.Optional;

import io.github.bryancruzcb.chamberwatch.TestcontainersConfiguration;
import io.github.bryancruzcb.chamberwatch.recipe.AlignedRun;
import io.github.bryancruzcb.chamberwatch.recipe.Aligner;
import io.github.bryancruzcb.chamberwatch.recipe.AlignmentResult;
import io.github.bryancruzcb.chamberwatch.recipe.EtchRuns;
import io.github.bryancruzcb.chamberwatch.recipe.RawRun;
import io.github.bryancruzcb.chamberwatch.recipe.RecipeGrid;
import io.github.bryancruzcb.chamberwatch.recipe.RunKey;
import io.github.bryancruzcb.chamberwatch.recipe.Source;
import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@Import(TestcontainersConfiguration.class)
class RunStoreTest {

	@Autowired
	private RunStore runs;

	@Autowired
	private JdbcClient jdbc;

	@Test
	void storingTheSameRunTwiceWritesItOnce() {
		LotRef lot = runs.upsertLot(new LotRecord(Source.SYNTHETIC, 901, Optional.empty(), Optional.empty()));
		RawRun raw = EtchRuns.etch().key(RunKey.simulated(7, 901, 1)).build().run();
		AlignmentResult result = Aligner.STANDARD.align(raw);
		AlignedRun run = result.orElseThrow();

		Optional<RunId> first = runs.insertIfAbsent(raw, result, lot);
		Optional<RunId> second = runs.insertIfAbsent(raw, result, lot);

		assertThat(first).isPresent();
		assertThat(second).isEmpty();
		assertThat(runs.exists(raw.key())).isTrue();
		int runId = first.get().value();
		assertThat(count("select count(*) from run where run_key = ?", raw.key().value())).isEqualTo(1);
		assertThat(count("select count(*) from sample where run_id = ?", runId))
			.isEqualTo((long) raw.sampleCount() * raw.channels().size());
		long filledSlots = 0;
		for (int slot = 0; slot < RecipeGrid.STANDARD.slotCount(); slot++) {
			if (run.hasSample(slot)) {
				filledSlots++;
			}
		}
		assertThat(count("select count(*) from sample where run_id = ? and slot is not null", runId))
			.isEqualTo(filledSlots * raw.channels().size());
		assertThat(count("select count(*) from run_phase_summary where run_id = ?", runId))
			.isEqualTo(run.summaries().size());
	}

	@Test
	void aStoredSampleCarriesTheSlotItFilled() {
		LotRef lot = runs.upsertLot(new LotRecord(Source.SYNTHETIC, 902, Optional.empty(), Optional.empty()));
		EtchRuns.Generated generated = EtchRuns.etch().key(RunKey.simulated(7, 902, 1)).build();
		AlignmentResult result = Aligner.STANDARD.align(generated.run());
		int runId = runs.insertIfAbsent(generated.run(), result, lot).orElseThrow().value();

		Double onset = jdbc.sql("""
				select s.t_s from sample s
				join recipe_slot r on r.slot = s.slot
				join channel c on c.id = s.channel_id
				where s.run_id = ? and c.name = 'Gas5Flow' and r.cycle = 50 and r.phase = 'SF6' and r.phase_offset = 0""")
			.param(runId)
			.query(Double.class)
			.single();

		assertThat(onset).isCloseTo(generated.sf6Onsets()[50], org.assertj.core.api.Assertions.within(1e-3));
	}

	private long count(String sql, Object param) {
		return jdbc.sql(sql).param(param).query(Long.class).single();
	}

}
