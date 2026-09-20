package io.github.bryancruzcb.chamberwatch.spectra;

import java.util.List;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;
import static org.assertj.core.api.Assertions.assertThatIllegalStateException;
import static org.assertj.core.api.Assertions.within;

class SlotMeansTest {

	/** Four slots 0.2 s apart from 10.0 s, with the third one never filled by the telemetry. */
	private static final float[] SLOT_TIMES = { 10.0f, 10.2f, Float.NaN, 10.6f };

	@Test
	void everySampleOfASlotGoesIntoItsMean() {
		SlotMeans means = new SlotMeans(2, SLOT_TIMES, 0.1, 1);

		assertThat(means.add(9.99, new float[] { 1, 10 })).isTrue();
		assertThat(means.add(10.04, new float[] { 3, 30 })).isTrue();
		assertThat(means.add(10.21, new float[] { 5, 50 })).isTrue();

		List<float[]> reduced = means.finish();
		assertThat(reduced).hasSize(2);
		assertThat(reduced.get(0)[0]).isCloseTo(2, within(1e-6f));
		assertThat(reduced.get(1)[0]).isCloseTo(20, within(1e-6f));
		assertThat(reduced.get(0)[1]).isCloseTo(5, within(1e-6f));
		assertThat(reduced.get(0)[2]).isNaN();
		assertThat(reduced.get(0)[3]).isNaN();
	}

	@Test
	void aSampleFartherThanTheToleranceJoinsNoSlot() {
		SlotMeans means = new SlotMeans(1, SLOT_TIMES, 0.1, 1);

		assertThat(means.add(9.5, new float[] { 1 })).isFalse();
		assertThat(means.add(10.4, new float[] { 1 })).isFalse();
		assertThat(means.add(12.0, new float[] { 1 })).isFalse();
		assertThat(means.add(Double.NaN, new float[] { 1 })).isFalse();

		for (float value : means.finish().get(0)) {
			assertThat(value).isNaN();
		}
	}

	@Test
	void aSampleJoinsTheNearerOfTwoSlotsAndTheGapSlotTakesNothing() {
		SlotMeans means = new SlotMeans(1, SLOT_TIMES, 0.1, 1);

		assertThat(means.slotOf(10.09)).isEqualTo(0);
		assertThat(means.slotOf(10.11)).isEqualTo(1);
		assertThat(means.slotOf(10.2)).isEqualTo(1);
		assertThat(means.slotOf(10.42)).isEqualTo(-1);
		assertThat(means.slotOf(10.55)).isEqualTo(3);
	}

	@Test
	void aLineThatIsDarkInOneSampleLosesOnlyThatSample() {
		SlotMeans means = new SlotMeans(2, SLOT_TIMES, 0.1, 1);

		means.add(10.0, new float[] { 4, Float.NaN });
		means.add(10.02, new float[] { 6, 8 });

		List<float[]> reduced = means.finish();
		assertThat(reduced.get(0)[0]).isCloseTo(5, within(1e-6f));
		assertThat(reduced.get(1)[0]).isCloseTo(8, within(1e-6f));
	}

	@Test
	void itRefusesWhatItCannotReduce() {
		assertThatIllegalArgumentException().isThrownBy(() -> new SlotMeans(0, SLOT_TIMES, 0.1, 1));
		assertThatIllegalArgumentException().isThrownBy(() -> new SlotMeans(1, SLOT_TIMES, 0, 1));
		assertThatIllegalArgumentException()
			.isThrownBy(() -> new SlotMeans(1, new float[] { 10.2f, 10.0f }, 0.1, 1))
			.withMessageContaining("not in order");

		SlotMeans means = new SlotMeans(1, SLOT_TIMES, 0.1, 1);
		assertThatIllegalArgumentException().isThrownBy(() -> means.add(10.0, new float[] { 1, 2 }));
		means.finish();
		assertThatIllegalStateException().isThrownBy(() -> means.add(10.0, new float[] { 1 }));
		assertThatIllegalStateException().isThrownBy(means::finish);
	}

	@Test
	void aSlotWithFewerSamplesThanTheMinimumComesOutEmpty() {
		SlotMeans means = new SlotMeans(1, SLOT_TIMES, 0.1, 2);

		means.add(10.0, new float[] { 4 });
		means.add(10.19, new float[] { 6 });
		means.add(10.21, new float[] { 8 });

		float[] reduced = means.finish().get(0);
		assertThat(reduced[0]).isNaN();
		assertThat(reduced[1]).isCloseTo(7, within(1e-6f));
		assertThat(means.samplesPerSlot(0)[0]).isEqualTo(1);
		assertThat(means.samplesPerSlot(0)[1]).isEqualTo(2);
		assertThat(means.filledSlots()).isEqualTo(3);
	}

	@Test
	void aRunWithoutASingleFilledSlotReducesToNothing() {
		SlotMeans means = new SlotMeans(1, new float[] { Float.NaN, Float.NaN }, 0.1, 1);

		assertThat(means.add(10.0, new float[] { 1 })).isFalse();
		assertThat(means.finish().get(0)).hasSize(2);
	}

}
