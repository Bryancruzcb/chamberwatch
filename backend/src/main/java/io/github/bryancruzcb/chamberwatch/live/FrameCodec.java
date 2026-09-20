package io.github.bryancruzcb.chamberwatch.live;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;
import io.github.bryancruzcb.chamberwatch.recipe.RunKey;
import io.github.bryancruzcb.chamberwatch.sim.FaultKind;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Reads the simulator's lines into {@link Frame}s, and writes the commands that go back.
 *
 * <p>The boundary of the live source: everything that arrives is parsed here once, into types the rest of the
 * code can trust. A line whose type this version does not know becomes {@link Frame.Unknown} rather than an
 * error, so a newer simulator that adds a frame still works with an older reader.
 *
 * <p>A calculation: the same text always gives the same frame.
 */
public final class FrameCodec {

	private static final JsonMapper JSON = JsonMapper.builder().build();

	private FrameCodec() {
	}

	/**
	 * @throws IllegalArgumentException when the line is not a JSON object, or a frame it knows is missing a field
	 *                                  it needs
	 */
	public static Frame parse(String line) {
		JsonNode node;
		try {
			node = JSON.readTree(line);
		}
		catch (RuntimeException ex) {
			throw new IllegalArgumentException("not a frame: " + shorten(line), ex);
		}
		if (node == null || !node.isObject()) {
			throw new IllegalArgumentException("not a frame: " + shorten(line));
		}
		String type = text(node, "type").orElseThrow(() -> new IllegalArgumentException("a frame needs a type"));
		return switch (type) {
			case "hello" -> hello(node);
			case "sample" -> sample(node);
			case "ack" -> ack(node);
			case "end" -> end(node);
			case "error" -> new Frame.Failure(text(node, "reason").orElse("unknown"));
			default -> new Frame.Unknown(type);
		};
	}

	/** The command that puts a fault into a running wafer. */
	public static String inject(FaultKind kind, ChannelName channel, double startS, Optional<Double> durationS,
			double magnitude) {
		StringBuilder text = new StringBuilder("{\"cmd\":\"inject\",\"kind\":\"").append(kind.name())
			.append("\",\"channel\":\"")
			.append(channel.value())
			.append("\",\"start_s\":")
			.append(startS)
			.append(",\"duration_s\":")
			.append(durationS.map(String::valueOf).orElse("null"))
			.append(",\"magnitude\":")
			.append(magnitude)
			.append('}');
		return text.toString();
	}

	public static String abort() {
		return "{\"cmd\":\"abort\"}";
	}

	private static Frame hello(JsonNode node) {
		long seed = number(node, "seed", "a hello").longValue();
		int lot = number(node, "lot", "a hello").intValue();
		int wafer = number(node, "wafer", "a hello").intValue();
		JsonNode names = node.get("channels");
		if (names == null || !names.isArray() || names.isEmpty()) {
			throw new IllegalArgumentException("a hello needs its channels");
		}
		List<ChannelName> channels = new ArrayList<>(names.size());
		for (JsonNode name : names) {
			channels.add(ChannelName.of(name.stringValue()));
		}
		RunKey key = RunKey.live(seed, lot, wafer);
		String declared = text(node, "run").orElse(key.value());
		if (!declared.equals(key.value())) {
			throw new IllegalArgumentException(
					"the hello calls the run " + declared + ", which is not " + key.value());
		}
		double period = node.has("period_s") ? node.get("period_s").doubleValue() : 0.2;
		return new Frame.Hello(key, seed, lot, wafer, period, channels);
	}

	private static Frame sample(JsonNode node) {
		JsonNode readings = node.get("v");
		if (readings == null || !readings.isArray()) {
			throw new IllegalArgumentException("a sample needs its readings");
		}
		float[] values = new float[readings.size()];
		for (int at = 0; at < values.length; at++) {
			values[at] = (float) readings.get(at).doubleValue();
		}
		return new Frame.Sample(number(node, "tick", "a sample").intValue(),
				number(node, "t", "a sample").doubleValue(), text(node, "state").orElse("UNKNOWN"),
				node.has("cycle") ? node.get("cycle").intValue() : 0, values);
	}

	private static Frame ack(JsonNode node) {
		return new Frame.Ack(text(node, "cmd").orElse("?"), node.has("tick") ? node.get("tick").intValue() : 0,
				node.has("accepted") && node.get("accepted").booleanValue(), text(node, "refused"),
				text(node, "detail"));
	}

	private static Frame end(JsonNode node) {
		JsonNode fault = node.get("fault");
		Optional<Frame.StreamedFault> streamed = Optional.empty();
		if (fault != null && fault.isObject()) {
			Optional<Double> duration = (fault.has("duration_s") && !fault.get("duration_s").isNull())
					? Optional.of(fault.get("duration_s").doubleValue()) : Optional.empty();
			streamed = Optional.of(new Frame.StreamedFault(FaultKind.valueOf(fault.get("kind").stringValue()),
					ChannelName.of(fault.get("channel").stringValue()), fault.get("start_s").doubleValue(), duration,
					fault.has("magnitude") ? fault.get("magnitude").doubleValue() : 0.0));
		}
		return new Frame.End(text(node, "reason").orElse("UNKNOWN"),
				node.has("samples") ? node.get("samples").intValue() : 0, streamed);
	}

	private static Optional<String> text(JsonNode node, String field) {
		JsonNode value = node.get(field);
		return (value == null || value.isNull() || !value.isString()) ? Optional.empty()
				: Optional.of(value.stringValue());
	}

	private static JsonNode number(JsonNode node, String field, String what) {
		JsonNode value = node.get(field);
		if (value == null || !value.isNumber()) {
			throw new IllegalArgumentException(what + " needs " + field);
		}
		return value;
	}

	private static String shorten(String line) {
		return line.length() <= 80 ? line : line.substring(0, 80) + "...";
	}

}
