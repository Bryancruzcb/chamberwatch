package io.github.bryancruzcb.chamberwatch.live;

import java.util.List;

import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;
import io.github.bryancruzcb.chamberwatch.recipe.RawRun;
import io.github.bryancruzcb.chamberwatch.recipe.RunKey;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;
import static org.assertj.core.api.Assertions.assertThatIllegalStateException;

class LiveRunTest {

	private static final RunKey KEY = RunKey.live(7, 1, 1);

	/** The simulator sends its channels in its own order, which is not the sorted one the run stores. */
	private static Frame.Hello hello(String... channels) {
		return new Frame.Hello(KEY, 7, 1, 1, 0.2, List.of(channels).stream().map(ChannelName::of).toList());
	}

	private static Frame.Sample sample(int tick, double timeS, float... values) {
		return new Frame.Sample(tick, timeS, "ETCH_SF6", 1, values);
	}

	@Test
	void aReadingEndsUpUnderItsOwnChannelWhateverOrderItArrivedIn() {
		LiveRun run = new LiveRun(hello("Pressure", "Gas5Flow"));

		run.add(sample(1, 0.2, 0.042f, 580.6f));
		run.add(sample(2, 0.4, 0.043f, 581.0f));

		RawRun raw = run.finish();
		assertThat(raw.key()).isEqualTo(KEY);
		assertThat(raw.sampleCount()).isEqualTo(2);
		int gas5 = raw.channels().indexOf(ChannelName.of("Gas5Flow"));
		int pressure = raw.channels().indexOf(ChannelName.of("Pressure"));
		assertThat(raw.value(gas5, 0)).isEqualTo(580.6f);
		assertThat(raw.value(pressure, 0)).isEqualTo(0.042f);
		assertThat(raw.value(gas5, 1)).isEqualTo(581.0f);
		// a raw run counts from its own first sample, so the stream's 0.2 s and 0.4 s become 0 and 0.2
		assertThat(raw.time(0)).isCloseTo(0.0, org.assertj.core.api.Assertions.within(1e-6));
		assertThat(raw.time(1)).isCloseTo(0.2, org.assertj.core.api.Assertions.within(1e-6));
	}

	@Test
	void aSampleThatDoesNotMatchTheHelloIsRefused() {
		LiveRun run = new LiveRun(hello("Pressure", "Gas5Flow"));

		assertThatIllegalArgumentException().isThrownBy(() -> run.add(sample(1, 0.2, 1.0f)))
			.withMessageContaining("not 2");
	}

	@Test
	void aStreamThatGoesBackInTimeIsRefused() {
		LiveRun run = new LiveRun(hello("Pressure"));
		run.add(sample(1, 1.0, 0.04f));

		assertThatIllegalArgumentException().isThrownBy(() -> run.add(sample(2, 0.8, 0.04f)))
			.withMessageContaining("back in time");
	}

	@Test
	void aStreamThatNeverStopsIsRefusedBeforeItFillsTheHeap() {
		LiveRun run = new LiveRun(hello("Pressure"));
		for (int sample = 0; sample < LiveRun.MAXIMUM_SAMPLES; sample++) {
			run.add(sample(sample + 1, sample * 0.2, 0.04f));
		}

		assertThatIllegalStateException()
			.isThrownBy(() -> run.add(sample(LiveRun.MAXIMUM_SAMPLES + 1, 9999.0, 0.04f)))
			.withMessageContaining("longer than any run");
	}

	@Test
	void aRunThatCarriedNothingIsNotARun() {
		LiveRun run = new LiveRun(hello("Pressure"));

		assertThatIllegalStateException().isThrownBy(run::finish).withMessageContaining("carried no samples");
	}

	@Test
	void aRunIsFinishedOnlyOnce() {
		LiveRun run = new LiveRun(hello("Pressure"));
		run.add(sample(1, 0.2, 0.04f));
		run.finish();

		assertThatIllegalStateException().isThrownBy(run::finish);
		assertThatIllegalStateException().isThrownBy(() -> run.add(sample(2, 0.4, 0.04f)));
	}

	@Test
	void aHelloThatNamesAChannelTwiceIsRefused() {
		assertThatIllegalArgumentException().isThrownBy(() -> new LiveRun(hello("Pressure", "Pressure")))
			.withMessageContaining("twice");
	}

}
