package io.github.bryancruzcb.chamberwatch.store;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import io.github.bryancruzcb.chamberwatch.TestcontainersConfiguration;
import io.github.bryancruzcb.chamberwatch.detect.Baseline;
import io.github.bryancruzcb.chamberwatch.detect.DetectorConfig;
import io.github.bryancruzcb.chamberwatch.detect.HealthModel;
import io.github.bryancruzcb.chamberwatch.detect.RunAssessment;
import io.github.bryancruzcb.chamberwatch.recipe.AlignedRun;
import io.github.bryancruzcb.chamberwatch.recipe.Aligner;
import io.github.bryancruzcb.chamberwatch.recipe.AlignmentResult;
import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;
import io.github.bryancruzcb.chamberwatch.recipe.EtchRuns;
import io.github.bryancruzcb.chamberwatch.recipe.RawRun;
import io.github.bryancruzcb.chamberwatch.recipe.RunKey;
import io.github.bryancruzcb.chamberwatch.recipe.Source;
import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@Import(TestcontainersConfiguration.class)
class BaselineStoreTest {

	private static final ChannelName PRESSURE = ChannelName.of("Pressure");

	@Autowired
	private RunStore runs;

	@Autowired
	private BaselineStore baselines;

	private final DetectorConfig config = DetectorConfig.defaults();

	@Test
	void aStoredBaselineAndRunScoreExactlyLikeTheOnesInMemory() {
		Lot lot = storeLot(930);
		Baseline fitted = HealthModel.fit(lot.good().stream(), config);
		BaselineRef ref = baselines.insert(Source.SYNTHETIC, fingerprint(fitted), 0, fitted, lot.ids());

		Baseline loaded = baselines.load(ref, config);
		AlignedRun reloaded = runs.loadAligned(lot.faultedId());

		RunAssessment inMemory = HealthModel.assess(lot.faulted(), fitted);
		assertThat(inMemory.firstChannel()).contains(PRESSURE);
		assertThat(HealthModel.assess(reloaded, loaded)).isEqualTo(inMemory);
		assertThat(reloaded.copySlotTimes()).isEqualTo(lot.faulted().copySlotTimes());
		assertThat(reloaded.channels()).isEqualTo(lot.faulted().channels());
		for (int channel = 0; channel < reloaded.channels().size(); channel++) {
			assertThat(reloaded.copyProfile(channel)).isEqualTo(lot.faulted().copyProfile(channel));
		}
		assertThat(reloaded.report().lastCycle()).isEqualTo(lot.faulted().report().lastCycle());
		assertThat(loaded.goodRuns()).isEqualTo(fitted.goodRuns());
		assertThat(ref.goodRuns()).isEqualTo(3);
	}

	@Test
	void storingTheSameFingerprintTwiceReturnsTheFirstBaseline() {
		Lot lot = storeLot(931);
		Baseline fitted = HealthModel.fit(lot.good().stream(), config);

		BaselineRef first = baselines.insert(Source.SYNTHETIC, fingerprint(fitted), 0, fitted, lot.ids());
		BaselineRef second = baselines.insert(Source.SYNTHETIC, fingerprint(fitted), 0, fitted, lot.ids());

		assertThat(second).isEqualTo(first);
		assertThat(baselines.find(fingerprint(fitted))).contains(first);
	}

	@Test
	void scoringARunTwiceUnderOneBaselineWritesItOnce() {
		Lot lot = storeLot(932);
		Baseline fitted = HealthModel.fit(lot.good().stream(), config);
		BaselineRef ref = baselines.insert(Source.SYNTHETIC, fingerprint(fitted), 0, fitted, lot.ids());
		RunAssessment assessment = HealthModel.assess(lot.faulted(), fitted);

		assertThat(baselines.insertAssessment(ref, lot.faultedId(), lot.faulted(), assessment)).isTrue();
		assertThat(baselines.insertAssessment(ref, lot.faultedId(), lot.faulted(), assessment)).isFalse();
		assertThat(baselines.unscored(ref)).doesNotContain(lot.faultedId())
			.contains(lot.ids().get(lot.good().get(0).key()));
		assertThat(baselines.flaggedRuns(ref)).isEqualTo(1);
	}

	@Test
	void theCurrentBaselineNeverMovesToOneChosenFromOlderLabels() {
		Lot lot = storeLot(933);
		Baseline fromTwo = HealthModel.fit(lot.good().stream().limit(2), config);
		Baseline fromThree = HealthModel.fit(lot.good().stream(), config);
		BaselineRef newer = baselines.insert(Source.SYNTHETIC, fingerprint(fromThree), 0, fromThree, lot.ids());
		BaselineRef older = baselines.insert(Source.SYNTHETIC, fingerprint(fromTwo), -1, fromTwo, lot.ids());

		assertThat(baselines.makeCurrent(newer, 0)).isTrue();
		assertThat(baselines.makeCurrent(older, -1)).isFalse();
		assertThat(baselines.current(Source.SYNTHETIC)).contains(newer);
	}

	/** Three clean wafers and a fourth whose SF6 pressure reads 0.1 high from cycle 60 on. */
	private record Lot(List<AlignedRun> good, AlignedRun faulted, Map<RunKey, RunId> ids) {

		RunId faultedId() {
			return ids.get(faulted.key());
		}

	}

	private Lot storeLot(int lotNo) {
		LotRef lot = runs.upsertLot(new LotRecord(Source.SYNTHETIC, lotNo, Optional.empty(), Optional.empty()));
		Map<RunKey, RunId> ids = new HashMap<>();
		List<AlignedRun> good = new ArrayList<>();
		for (int position = 1; position <= 3; position++) {
			good.add(store(lot, EtchRuns.etch().key(RunKey.simulated(1, lotNo, position)), ids));
		}
		AlignedRun faulted = store(lot, EtchRuns.etch().key(RunKey.simulated(1, lotNo, 4)).pressureOffsetFrom(60, 0.1f),
				ids);
		return new Lot(good, faulted, ids);
	}

	private AlignedRun store(LotRef lot, EtchRuns.Builder builder, Map<RunKey, RunId> ids) {
		RawRun raw = builder.build().run();
		AlignmentResult result = Aligner.STANDARD.align(raw);
		ids.put(raw.key(), runs.insertIfAbsent(raw, result, lot).orElseThrow());
		return result.orElseThrow();
	}

	private Fingerprint fingerprint(Baseline baseline) {
		return Fingerprint.of(Source.SYNTHETIC, baseline.goodRuns(), config, Aligner.VERSION, HealthModel.VERSION);
	}

}
