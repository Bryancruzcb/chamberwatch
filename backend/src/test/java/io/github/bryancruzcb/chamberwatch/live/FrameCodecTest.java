package io.github.bryancruzcb.chamberwatch.live;

import java.util.Optional;

import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;
import io.github.bryancruzcb.chamberwatch.recipe.Source;
import io.github.bryancruzcb.chamberwatch.sim.FaultKind;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;
import static org.assertj.core.api.Assertions.within;

class FrameCodecTest {

	@Test
	void aHelloNamesTheWaferAndItsChannels() {
		Frame frame = FrameCodec.parse("{\"type\":\"hello\",\"protocol\":1,\"seed\":7,\"lot\":1,\"wafer\":3,"
				+ "\"run\":\"LIVE-s7-L1-W03\",\"period_s\":0.2,\"channels\":[\"Gas5Flow\",\"Pressure\"]}");

		assertThat(frame).isInstanceOf(Frame.Hello.class);
		Frame.Hello hello = (Frame.Hello) frame;
		assertThat(hello.key().value()).isEqualTo("LIVE-s7-L1-W03");
		assertThat(hello.key().source()).isEqualTo(Source.LIVE);
		assertThat(hello.key().positionInLot()).isEqualTo(3);
		assertThat(hello.seed()).isEqualTo(7);
		assertThat(hello.periodS()).isEqualTo(0.2);
		assertThat(hello.channels()).containsExactly(ChannelName.of("Gas5Flow"), ChannelName.of("Pressure"));
	}

	@Test
	void aHelloThatContradictsItsOwnRunKeyIsRefused() {
		assertThatIllegalArgumentException()
			.isThrownBy(() -> FrameCodec.parse("{\"type\":\"hello\",\"seed\":7,\"lot\":1,\"wafer\":3,"
					+ "\"run\":\"LIVE-s9-L1-W03\",\"channels\":[\"Pressure\"]}"))
			.withMessageContaining("LIVE-s7-L1-W03");
	}

	@Test
	void aSampleCarriesOneReadingPerChannel() {
		Frame frame = FrameCodec
			.parse("{\"type\":\"sample\",\"tick\":12,\"t\":2.4,\"state\":\"ETCH_SF6\",\"cycle\":1,\"v\":[580.6,0.042]}");

		Frame.Sample sample = (Frame.Sample) frame;
		assertThat(sample.tick()).isEqualTo(12);
		assertThat(sample.timeS()).isCloseTo(2.4, within(1e-9));
		assertThat(sample.state()).isEqualTo("ETCH_SF6");
		assertThat(sample.cycle()).isEqualTo(1);
		assertThat(sample.values()).containsExactly(580.6f, 0.042f);
	}

	@Test
	void anEndCarriesTheFaultThatWasInjected() {
		Frame.End end = (Frame.End) FrameCodec.parse("{\"type\":\"end\",\"reason\":\"COMPLETE\",\"samples\":3436,"
				+ "\"fault\":{\"kind\":\"GAS_FLOW_STUCK_LOW\",\"channel\":\"Gas5Flow\",\"start_s\":200.0,"
				+ "\"duration_s\":null,\"magnitude\":0.36}}");

		assertThat(end.complete()).isTrue();
		assertThat(end.samples()).isEqualTo(3436);
		Frame.StreamedFault fault = end.fault().orElseThrow();
		assertThat(fault.kind()).isEqualTo(FaultKind.GAS_FLOW_STUCK_LOW);
		assertThat(fault.channel()).isEqualTo(ChannelName.of("Gas5Flow"));
		assertThat(fault.startS()).isCloseTo(200.0, within(1e-9));
		assertThat(fault.durationS()).isEmpty();
		assertThat(fault.magnitude()).isCloseTo(0.36, within(1e-9));

		Frame.End clean = (Frame.End) FrameCodec.parse("{\"type\":\"end\",\"reason\":\"ABORTED\",\"samples\":10}");
		assertThat(clean.complete()).isFalse();
		assertThat(clean.fault()).isEmpty();
	}

	@Test
	void anAckSaysWhatWasRefusedAndWhy() {
		Frame.Ack refused = (Frame.Ack) FrameCodec.parse("{\"type\":\"ack\",\"cmd\":\"start\",\"tick\":0,"
				+ "\"accepted\":false,\"refused\":\"IL_NO_HELIUM_BACKSIDE\",\"detail\":\"HeliumBPPressure 3.2 below 12\"}");

		assertThat(refused.command()).isEqualTo("start");
		assertThat(refused.accepted()).isFalse();
		assertThat(refused.refused()).contains("IL_NO_HELIUM_BACKSIDE");
		assertThat(refused.detail()).contains("HeliumBPPressure 3.2 below 12");

		Frame.Ack taken = (Frame.Ack) FrameCodec.parse("{\"type\":\"ack\",\"cmd\":\"inject\",\"tick\":9,\"accepted\":true}");
		assertThat(taken.accepted()).isTrue();
		assertThat(taken.refused()).isEmpty();
	}

	@Test
	void aFrameThisVersionDoesNotKnowIsKeptRatherThanRefused() {
		assertThat(FrameCodec.parse("{\"type\":\"weather\",\"outlook\":\"fine\"}"))
			.isEqualTo(new Frame.Unknown("weather"));
		assertThat(FrameCodec.parse("{\"type\":\"error\",\"reason\":\"BUSY\"}"))
			.isEqualTo(new Frame.Failure("BUSY"));
	}

	@Test
	void aLineThatIsNotAFrameIsRefused() {
		assertThatIllegalArgumentException().isThrownBy(() -> FrameCodec.parse("not json"));
		assertThatIllegalArgumentException().isThrownBy(() -> FrameCodec.parse("[1,2,3]"));
		assertThatIllegalArgumentException().isThrownBy(() -> FrameCodec.parse("{\"tick\":1}"))
			.withMessageContaining("type");
		assertThatIllegalArgumentException()
			.isThrownBy(() -> FrameCodec.parse("{\"type\":\"sample\",\"tick\":1,\"t\":0.2}"))
			.withMessageContaining("readings");
		assertThatIllegalArgumentException()
			.isThrownBy(() -> FrameCodec.parse("{\"type\":\"hello\",\"seed\":7,\"lot\":1,\"wafer\":3}"))
			.withMessageContaining("channels");
	}

	@Test
	void theCommandsItWritesAreTheOnesTheSimulatorTakes() {
		assertThat(FrameCodec.inject(FaultKind.SENSOR_STUCK, ChannelName.of("HeliumBPPressure"), 312.4,
				Optional.of(6.0), 0.0))
			.isEqualTo("{\"cmd\":\"inject\",\"kind\":\"SENSOR_STUCK\",\"channel\":\"HeliumBPPressure\","
					+ "\"start_s\":312.4,\"duration_s\":6.0,\"magnitude\":0.0}");
		assertThat(FrameCodec.inject(FaultKind.GAS_FLOW_STUCK_LOW, ChannelName.of("Gas5Flow"), 200.0,
				Optional.empty(), 0.36))
			.contains("\"duration_s\":null");
		assertThat(FrameCodec.abort()).isEqualTo("{\"cmd\":\"abort\"}");
	}

}
