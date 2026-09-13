package io.github.bryancruzcb.chamberwatch.sim;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.OptionalDouble;
import java.util.SortedMap;
import java.util.TreeMap;
import java.util.stream.Collectors;

import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;
import io.github.bryancruzcb.chamberwatch.recipe.Phase;

/**
 * What the simulator knows about the public wafers: one {@link ChannelTemplate} per channel, and the swings
 * that good runs showed now and then. It is built once from the downloaded data by {@code sim-template} and
 * committed as {@value #RESOURCE}, so CI and tests never need the data.
 *
 * <p>The file is tab-separated text with one {@code channel} line per channel, one {@code phase} line per
 * phase of a varying channel, and one {@code swings} line. Numbers keep 6 significant digits, so formatting
 * a parsed template gives the same text back.
 */
public final class SimulationTemplate {

	public static final String RESOURCE = "/sim/template.tsv";

	private static final String HEADER = """
			# ChamberWatch simulation template, format 1. Built by `java -jar chamberwatch.jar sim-template` from the
			# public wafers of Zenodo record 17122442 (CC BY 4.0). Do not edit by hand: rebuild it.
			# channel  name  constant  idle  resolution  nonNegative  noiseRho  wanderPhi
			# phase  name  SF6|C4F8  lotSd  runSd  driftMean  driftSd  wanderSd  noiseSd  profile  trend
			# swings  goodRuns  channel:cycles:size,...
			""";

	private final SortedMap<ChannelName, ChannelTemplate> channels;

	private final Swings swings;

	private SimulationTemplate(SortedMap<ChannelName, ChannelTemplate> channels, Swings swings) {
		this.channels = channels;
		this.swings = swings;
	}

	/**
	 * A run of cycles whose level sat far from its run's level in a good public run.
	 *
	 * @param cycles how many cycles it lasted
	 * @param size   its mean distance from the run's level in band standard deviations, with its sign
	 */
	public record Swing(ChannelName channel, int cycles, double size) {

		public Swing {
			if (cycles < 1 || !Double.isFinite(size)) {
				throw new IllegalArgumentException("invalid swing of " + cycles + " cycles and size " + size);
			}
		}

	}

	/**
	 * @param goodRuns how many good runs the swings were counted over
	 * @param observed every swing seen, which the simulator draws from channel by channel
	 */
	public record Swings(int goodRuns, List<Swing> observed) {

		public Swings {
			observed = List.copyOf(observed);
			if (goodRuns < 1) {
				throw new IllegalArgumentException("swings need at least one good run");
			}
		}

		public List<Swing> of(ChannelName channel) {
			return observed.stream().filter((swing) -> swing.channel().equals(channel)).toList();
		}

	}

	public static SimulationTemplate of(Collection<ChannelTemplate> channels, Swings swings) {
		SortedMap<ChannelName, ChannelTemplate> byName = new TreeMap<>();
		for (ChannelTemplate channel : channels) {
			if (byName.put(channel.channel(), channel) != null) {
				throw new IllegalArgumentException("channel listed twice: " + channel.channel());
			}
		}
		return new SimulationTemplate(Collections.unmodifiableSortedMap(byName), swings);
	}

	/** The committed template. */
	public static SimulationTemplate bundled() {
		try (InputStream stream = SimulationTemplate.class.getResourceAsStream(RESOURCE)) {
			if (stream == null) {
				throw new IllegalStateException("no simulation template on the classpath at " + RESOURCE);
			}
			BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8));
			return parse(reader.lines().toList());
		}
		catch (IOException ex) {
			throw new UncheckedIOException(ex);
		}
	}

	/** @throws IllegalArgumentException naming the line that does not parse */
	public static SimulationTemplate parse(List<String> lines) {
		SortedMap<ChannelName, String[]> channelLines = new TreeMap<>();
		SortedMap<ChannelName, SortedMap<Phase, ChannelTemplate.PhaseTemplate>> phases = new TreeMap<>();
		Swings swings = null;
		for (int number = 1; number <= lines.size(); number++) {
			String line = lines.get(number - 1).strip();
			if (line.isEmpty() || line.startsWith("#")) {
				continue;
			}
			String[] fields = line.split("\t");
			try {
				switch (fields[0]) {
					case "channel" -> {
						expect(fields, 8);
						channelLines.put(ChannelName.of(fields[1]), fields);
					}
					case "phase" -> {
						expect(fields, 11);
						phases.computeIfAbsent(ChannelName.of(fields[1]), (name) -> new TreeMap<>())
							.put(Phase.valueOf(fields[2]),
									new ChannelTemplate.PhaseTemplate(numbers(fields[9]), numbers(fields[10]),
											Double.parseDouble(fields[3]), Double.parseDouble(fields[4]),
											Double.parseDouble(fields[5]), Double.parseDouble(fields[6]),
											Double.parseDouble(fields[7]), Double.parseDouble(fields[8])));
					}
					case "swings" -> {
						if (fields.length != 2 && fields.length != 3) {
							throw new IllegalArgumentException("expected 2 or 3 fields, found " + fields.length);
						}
						List<Swing> observed = (fields.length == 2) ? List.of()
								: Arrays.stream(fields[2].split(","))
									.map((triple) -> triple.split(":"))
									.map((triple) -> new Swing(ChannelName.of(triple[0]), Integer.parseInt(triple[1]),
											Double.parseDouble(triple[2])))
									.toList();
						swings = new Swings(Integer.parseInt(fields[1]), observed);
					}
					default -> throw new IllegalArgumentException("unknown record " + fields[0]);
				}
			}
			catch (RuntimeException ex) {
				throw new IllegalArgumentException("simulation template line " + number + ": " + ex.getMessage(), ex);
			}
		}
		if (swings == null) {
			throw new IllegalArgumentException("simulation template has no swings line");
		}
		List<ChannelTemplate> channels = new ArrayList<>();
		channelLines.forEach((name, fields) -> {
			SortedMap<Phase, ChannelTemplate.PhaseTemplate> byPhase = phases.getOrDefault(name, new TreeMap<>());
			channels.add(new ChannelTemplate(name,
					fields[2].equals("-") ? OptionalDouble.empty() : OptionalDouble.of(Double.parseDouble(fields[2])),
					Double.parseDouble(fields[3]), Double.parseDouble(fields[4]), Boolean.parseBoolean(fields[5]),
					Double.parseDouble(fields[6]), Double.parseDouble(fields[7]),
					Optional.ofNullable(byPhase.get(Phase.SF6)), Optional.ofNullable(byPhase.get(Phase.C4F8))));
		});
		return of(channels, swings);
	}

	/** The canonical text: the committed file is exactly this. */
	public String format() {
		StringBuilder text = new StringBuilder(HEADER);
		for (ChannelTemplate channel : channels.values()) {
			text.append(String.join("\t", "channel", channel.channel().value(),
					channel.constant().isPresent() ? number(channel.constant().getAsDouble()) : "-", number(channel.idle()),
					number(channel.resolution()), Boolean.toString(channel.nonNegative()), number(channel.noiseRho()),
					number(channel.wanderPhi())))
				.append('\n');
			for (Phase phase : Phase.values()) {
				if (channel.constant().isPresent()) {
					continue;
				}
				ChannelTemplate.PhaseTemplate template = channel.phase(phase);
				text.append(String.join("\t", "phase", channel.channel().value(), phase.name(), number(template.lotSd()),
						number(template.runSd()), number(template.driftMean()), number(template.driftSd()),
						number(template.wanderSd()), number(template.noiseSd()), numbers(template.profile()),
						numbers(template.trend())))
					.append('\n');
			}
		}
		text.append("swings\t").append(swings.goodRuns());
		if (!swings.observed().isEmpty()) {
			text.append('\t')
				.append(swings.observed()
					.stream()
					.map((swing) -> swing.channel() + ":" + swing.cycles() + ":" + number(swing.size()))
					.collect(Collectors.joining(",")));
		}
		return text.append('\n').toString();
	}

	public SortedMap<ChannelName, ChannelTemplate> channels() {
		return channels;
	}

	public ChannelTemplate channel(ChannelName name) {
		ChannelTemplate channel = channels.get(name);
		if (channel == null) {
			throw new IllegalArgumentException("the simulation template has no channel " + name);
		}
		return channel;
	}

	public Swings swings() {
		return swings;
	}

	private static void expect(String[] fields, int count) {
		if (fields.length != count) {
			throw new IllegalArgumentException("expected " + count + " fields, found " + fields.length);
		}
	}

	private static String number(double value) {
		return String.format(Locale.ROOT, "%.6g", value);
	}

	private static String numbers(List<Double> values) {
		return values.stream().map(SimulationTemplate::number).collect(Collectors.joining(","));
	}

	private static List<Double> numbers(String field) {
		return Arrays.stream(field.split(",")).map(Double::valueOf).toList();
	}

}
