package io.github.bryancruzcb.chamberwatch.eval;

import java.util.Collections;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.SortedMap;
import java.util.TreeMap;

/** What an evaluation measured, by name. Names sort, so the metrics file reads the same on every run. */
public record Metrics(SortedMap<String, Double> values) {

	public Metrics {
		values = Collections.unmodifiableSortedMap(new TreeMap<>(values));
	}

	public static Metrics of(Map<String, Double> values) {
		return new Metrics(new TreeMap<>(values));
	}

	/** @throws NoSuchElementException for a name the evaluation does not produce */
	public double get(String name) {
		Double value = values.get(name);
		if (value == null) {
			throw new NoSuchElementException("no metric " + name);
		}
		return value;
	}

	public String format() {
		return MetricsFile.format(values);
	}

}
