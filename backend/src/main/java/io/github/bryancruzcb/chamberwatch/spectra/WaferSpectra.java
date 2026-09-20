package io.github.bryancruzcb.chamberwatch.spectra;

import java.util.List;

import io.github.bryancruzcb.chamberwatch.recipe.RunKey;

/**
 * One wafer's emission lines as the spectrometer recorded them: for each line, its window's sum in every sample,
 * with the samples' times counted from the record's own first sample. The wavelengths themselves are left in the
 * file; only the lines survive the read.
 *
 * @param sinceStart seconds since the record's first sample, ascending, one per sample
 * @param values     one array per line, in the order of {@code lines}, each one value per sample
 */
public record WaferSpectra(RunKey key, List<EmissionLine> lines, double[] sinceStart, float[][] values) {

	public WaferSpectra {
		lines = List.copyOf(lines);
		if (values.length != lines.size()) {
			throw new IllegalArgumentException(values.length + " series for " + lines.size() + " lines");
		}
		for (float[] line : values) {
			if (line.length != sinceStart.length) {
				throw new IllegalArgumentException("a line has " + line.length + " values for " + sinceStart.length
						+ " samples");
			}
		}
	}

	public int samples() {
		return sinceStart.length;
	}

	/** The line named, by the channel it becomes. */
	public float[] line(io.github.bryancruzcb.chamberwatch.recipe.ChannelName channel) {
		for (int at = 0; at < lines.size(); at++) {
			if (lines.get(at).channel().equals(channel)) {
				return values[at];
			}
		}
		throw new IllegalArgumentException("this record has no " + channel.value());
	}

	/** How long the record ran, in seconds. */
	public double lengthS() {
		return (sinceStart.length == 0) ? 0 : sinceStart[sinceStart.length - 1];
	}

}
