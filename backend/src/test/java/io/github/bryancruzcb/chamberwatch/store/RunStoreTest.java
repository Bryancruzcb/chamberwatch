package io.github.bryancruzcb.chamberwatch.store;

import java.util.Arrays;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;

import io.github.bryancruzcb.chamberwatch.TestcontainersConfiguration;
import io.github.bryancruzcb.chamberwatch.recipe.AlignedRun;
import io.github.bryancruzcb.chamberwatch.recipe.Aligner;
import io.github.bryancruzcb.chamberwatch.recipe.AlignmentResult;
import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;
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

		Optional<RunId> first = runs.insertIfAbsent(raw, result, lot, Optional.empty());
		Optional<RunId> second = runs.insertIfAbsent(raw, result, lot, Optional.empty());

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
		int runId = runs.insertIfAbsent(generated.run(), result, lot, Optional.empty()).orElseThrow().value();

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

	@Test
	void aReductionAddsItsChannelsToAStoredRunAndAReductionAfterItReplacesThem() {
		LotRef lot = runs.upsertLot(new LotRecord(Source.SYNTHETIC, 903, Optional.empty(), Optional.empty()));
		RawRun raw = EtchRuns.etch().key(RunKey.simulated(7, 903, 1)).build().run();
		AlignmentResult result = Aligner.STANDARD.align(raw);
		AlignedRun telemetry = result.orElseThrow();
		RunId id = runs.insertIfAbsent(raw, result, lot, Optional.empty()).orElseThrow();
		int slots = RecipeGrid.STANDARD.slotCount();
		long filled = 0;
		for (int slot = 0; slot < slots; slot++) {
			if (telemetry.hasSample(slot)) {
				filled++;
			}
		}
		ChannelName line = ChannelName.of("EmissionF703");
		float[] values = new float[slots];
		Arrays.fill(values, Float.NaN);
		for (int slot = 0; slot < slots; slot++) {
			if (telemetry.hasSample(slot)) {
				values[slot] = 10 + slot % 7;
			}
		}

		runs.putSlotChannels(id, new TreeMap<>(Map.of(line, values)), 1);

		assertThat(runs.find(raw.key()).orElseThrow().spectraVersion()).isEqualTo(1);
		assertThat(count("select count(*) from sample s join channel c on c.id = s.channel_id "
				+ "where s.run_id = ? and c.name = 'EmissionF703'", id.value())).isEqualTo(filled);
		assertThat(count("select count(*) from run_phase_summary s join channel c on c.id = s.channel_id "
				+ "where s.run_id = ? and c.name = 'EmissionF703'", id.value())).isEqualTo(2);
		AlignedRun loaded = runs.loadAligned(id);
		assertThat(loaded.channels().contains(line)).isTrue();
		assertThat(loaded.channels().size()).isEqualTo(telemetry.channels().size() + 1);
		int index = loaded.channels().indexOf(line);
		for (int slot = 0; slot < slots; slot++) {
			if (telemetry.hasSample(slot)) {
				assertThat(loaded.value(index, slot)).isEqualTo(values[slot]);
				assertThat(loaded.timeAt(slot)).isEqualTo(telemetry.timeAt(slot));
			}
			else {
				assertThat(loaded.value(index, slot)).isNaN();
				assertThat(loaded.timeAt(slot)).isNaN();
			}
		}

		float[] second = values.clone();
		for (int slot = 0; slot < slots; slot++) {
			if (!Float.isNaN(second[slot])) {
				second[slot] += 1;
			}
		}
		runs.putSlotChannels(id, new TreeMap<>(Map.of(line, second)), 2);

		assertThat(runs.find(raw.key()).orElseThrow().spectraVersion()).isEqualTo(2);
		assertThat(count("select count(*) from sample s join channel c on c.id = s.channel_id "
				+ "where s.run_id = ? and c.name = 'EmissionF703'", id.value())).isEqualTo(filled);
		assertThat(runs.loadAligned(id).value(index, firstFilledSlot(telemetry, slots)))
			.isEqualTo(second[firstFilledSlot(telemetry, slots)]);
	}

	private static int firstFilledSlot(AlignedRun run, int slots) {
		for (int slot = 0; slot < slots; slot++) {
			if (run.hasSample(slot)) {
				return slot;
			}
		}
		throw new IllegalStateException("the run filled no slot");
	}

	private long count(String sql, Object param) {
		return jdbc.sql(sql).param(param).query(Long.class).single();
	}

}
