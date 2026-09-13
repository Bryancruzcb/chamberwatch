package io.github.bryancruzcb.chamberwatch.store;

import java.util.List;

import io.github.bryancruzcb.chamberwatch.detect.DetectorConfig;
import io.github.bryancruzcb.chamberwatch.recipe.RunKey;
import io.github.bryancruzcb.chamberwatch.recipe.Source;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class FingerprintTest {

	private static final List<RunKey> GOOD = List.of(RunKey.ofPublicGroup("Day_2024_07_02_Wafer_01"),
			RunKey.ofPublicGroup("Day_2024_07_02_Wafer_02"));

	private final DetectorConfig defaults = DetectorConfig.defaults();

	private final Fingerprint base = Fingerprint.of(Source.PUBLIC, GOOD, defaults, 1, 1);

	@Test
	void theSameGoodRunsInAnyOrderGiveTheSameFingerprint() {
		assertThat(Fingerprint.of(Source.PUBLIC, GOOD.reversed(), defaults, 1, 1)).isEqualTo(base);
		assertThat(base.hex()).hasSize(64);
	}

	@Test
	void anythingThatChangesTheStoredRowsChangesTheFingerprint() {
		DetectorConfig otherK = new DetectorConfig(defaults.band(), new DetectorConfig.LimitRule(5.0, 5), defaults.runZ(),
				defaults.drift(), defaults.goodRunsPerLot());

		assertThat(Fingerprint.of(Source.PUBLIC, GOOD, otherK, 1, 1)).isNotEqualTo(base);
		assertThat(Fingerprint.of(Source.PUBLIC, GOOD.subList(0, 1), defaults, 1, 1)).isNotEqualTo(base);
		assertThat(Fingerprint.of(Source.SYNTHETIC, GOOD, defaults, 1, 1)).isNotEqualTo(base);
		assertThat(Fingerprint.of(Source.PUBLIC, GOOD, defaults, 2, 1)).isNotEqualTo(base);
		assertThat(Fingerprint.of(Source.PUBLIC, GOOD, defaults, 1, 2)).isNotEqualTo(base);
	}

	@Test
	void theDriftRuleAndTheGoodRunPolicyLeaveItAlone() {
		DetectorConfig otherDrift = new DetectorConfig(defaults.band(), defaults.limit(), defaults.runZ(),
				new DetectorConfig.DriftRule(2.0, 4, 2.5, 10), 2);

		assertThat(Fingerprint.of(Source.PUBLIC, GOOD, otherDrift, 1, 1)).isEqualTo(base);
	}

}
