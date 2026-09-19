package io.github.bryancruzcb.chamberwatch.ingest;

import java.io.IOException;
import java.io.PrintStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import io.github.bryancruzcb.chamberwatch.recipe.AlignmentResult;
import io.github.bryancruzcb.chamberwatch.recipe.Aligner;
import io.github.bryancruzcb.chamberwatch.recipe.Phase;
import io.github.bryancruzcb.chamberwatch.recipe.RawRun;
import io.github.bryancruzcb.chamberwatch.recipe.RunKey;
import io.github.bryancruzcb.chamberwatch.sim.ChannelTemplate;
import io.github.bryancruzcb.chamberwatch.sim.SimulationTemplate;
import io.github.bryancruzcb.chamberwatch.sim.TemplateBuilder;

/**
 * The {@code sim-template} command: measures the simulation template from the public wafers and writes it,
 * by default over the committed resource. It needs no database, so the application runs it before Spring
 * starts.
 */
public final class SimTemplateCommand {

	static final String DEFAULT_OUT = "src/main/resources" + SimulationTemplate.RESOURCE;

	private SimTemplateCommand() {
	}

	/**
	 * @param args {@code --data=<dir>}, {@code --md5=<list>} and {@code --out=<file>}
	 * @return 0 once the template is written, 1 when a wafer does not align
	 */
	public static int run(List<String> args, PrintStream out) {
		Path dataDir = Path.of(AlignCommand.option(args, "data", "data/public/zenodo17122442"));
		Path md5List = Path.of(AlignCommand.option(args, "md5", "docs/zenodo17122442.md5"));
		Path output = Path.of(AlignCommand.option(args, "out", DEFAULT_OUT));
		SimulationTemplate template = build(dataDir, md5List, out);
		if (template == null) {
			return 1;
		}
		try {
			Files.createDirectories(output.toAbsolutePath().getParent());
			Files.writeString(output, template.format(), StandardCharsets.UTF_8);
		}
		catch (IOException ex) {
			throw new UncheckedIOException(ex);
		}
		out.println(summary(template));
		out.println("wrote " + output.toAbsolutePath());
		return 0;
	}

	/** @return the template, or null after printing the wafers that did not align */
	static SimulationTemplate build(Path dataDir, Path md5List, PrintStream out) {
		Map<String, DataFiles.VerifiedFile> files = DataFiles.verify(dataDir, md5List,
				List.of(AlignCommand.PROCESS_DATA, AlignCommand.DICTIONARY));
		List<TemplateBuilder.Wafer> wafers = new ArrayList<>();
		boolean failed = false;
		try (NetcdfTelemetrySource source = NetcdfTelemetrySource.open(files.get(AlignCommand.PROCESS_DATA),
				files.get(AlignCommand.DICTIONARY))) {
			for (RunKey key : source.keys()) {
				RawRun raw = source.read(key);
				switch (Aligner.STANDARD.align(raw)) {
					case AlignmentResult.Aligned aligned -> wafers.add(new TemplateBuilder.Wafer(raw, aligned.run()));
					case AlignmentResult.Failed failure -> {
						out.println(key.value() + " FAILED " + failure.reason());
						failed = true;
					}
				}
			}
		}
		return failed ? null : TemplateBuilder.build(wafers, 3);
	}

	static String summary(SimulationTemplate template) {
		StringBuilder text = new StringBuilder(
				"channel phase level lotSd runSd driftAtLastWafer driftScaleSd wanderSd noiseSd noiseRho wanderPhi resolution\n");
		for (ChannelTemplate channel : template.channels().values()) {
			if (channel.constant().isPresent()) {
				text.append(String.format(Locale.ROOT, "%s constant %.6g%n", channel.channel(), channel.constant().getAsDouble()));
				continue;
			}
			for (Phase phase : Phase.values()) {
				ChannelTemplate.PhaseTemplate p = channel.phase(phase);
				int to = (phase == Phase.SF6) ? 20 : 4;
				text.append(String.format(Locale.ROOT, "%s %s %.5g %.3g %.3g %.3g %.3g %.3g %.3g %.2f %.2f %.3g%n",
						channel.channel(), phase, p.level(1, to), p.lotSd(), p.runSd(), p.driftAt(p.drift().size()),
						p.driftScaleSd(), p.wanderSd(), p.noiseSd(), channel.noiseRho(), channel.wanderPhi(),
						channel.resolution()));
			}
		}
		SimulationTemplate.Swings swings = template.swings();
		text.append(String.format(Locale.ROOT, "swings over %d good runs: %d%n", swings.goodRuns(), swings.observed().size()));
		for (ChannelTemplate channel : template.channels().values()) {
			List<SimulationTemplate.Swing> observed = swings.of(channel.channel());
			if (!observed.isEmpty()) {
				text.append(String.format(Locale.ROOT, "  %s %d: %s%n", channel.channel(), observed.size(),
						observed.stream()
							.map((swing) -> String.format(Locale.ROOT, "%dx%.1f", swing.cycles(), swing.size()))
							.collect(java.util.stream.Collectors.joining(" "))));
			}
		}
		return text.toString();
	}

}
