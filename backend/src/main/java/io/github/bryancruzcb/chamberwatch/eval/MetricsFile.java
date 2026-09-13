package io.github.bryancruzcb.chamberwatch.eval;

import java.util.Locale;
import java.util.SortedMap;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * The format of results/metrics.json: one flat JSON object, keys sorted, every number with 4 decimals, so a
 * change to any metric shows as a one-line diff.
 */
public final class MetricsFile {

	private static final Pattern ENTRY = Pattern.compile("\"([^\"]+)\"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)");

	private MetricsFile() {
	}

	public static String format(SortedMap<String, Double> values) {
		return values.entrySet()
			.stream()
			.map((entry) -> String.format(Locale.ROOT, "  \"%s\": %.4f", entry.getKey(), entry.getValue()))
			.collect(Collectors.joining(",\n", "{\n", "\n}\n"));
	}

	/** Reads the flat object that {@link #format} writes, and nothing more general. */
	public static SortedMap<String, Double> parse(String text) {
		SortedMap<String, Double> values = new TreeMap<>();
		Matcher matcher = ENTRY.matcher(text);
		while (matcher.find()) {
			values.put(matcher.group(1), Double.parseDouble(matcher.group(2)));
		}
		return values;
	}

}
