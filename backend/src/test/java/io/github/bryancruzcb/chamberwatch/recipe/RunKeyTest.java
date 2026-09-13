package io.github.bryancruzcb.chamberwatch.recipe;

import java.time.LocalDate;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

class RunKeyTest {

	@Test
	void aPublicGroupNameCarriesTheLotDayAndTheWafer() {
		RunKey key = RunKey.ofPublicGroup("Day_2024_07_09_Wafer_07");

		assertThat(key.source()).isEqualTo(Source.PUBLIC);
		assertThat(key.positionInLot()).isEqualTo(7);
		assertThat(key.day()).contains(LocalDate.of(2024, 7, 9));
		assertThat(key.experimentKey()).contains("2024-07-09_07");
	}

	@Test
	void aSimulatedKeyEmbedsSeedLotAndWafer() {
		RunKey key = RunKey.simulated(7, 901, 3);

		assertThat(key.value()).isEqualTo("SIM-s7-L901-W03");
		assertThat(key.day()).isEmpty();
		assertThat(key.experimentKey()).isEmpty();
	}

	@Test
	void malformedNamesAreRejected() {
		assertThatIllegalArgumentException().isThrownBy(() -> RunKey.ofPublicGroup("Day_2024_13_09_Wafer_07"));
		assertThatIllegalArgumentException().isThrownBy(() -> RunKey.ofPublicGroup("Wafer_07"));
		assertThatIllegalArgumentException().isThrownBy(() -> new RunKey("Day_2024_07_09_Wafer_07", Source.PUBLIC, 8));
	}

}
