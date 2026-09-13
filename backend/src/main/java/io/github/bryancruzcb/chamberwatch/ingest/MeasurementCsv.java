package io.github.bryancruzcb.chamberwatch.ingest;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Pattern;

import io.github.bryancruzcb.chamberwatch.store.MeasurementRecord;
import io.github.bryancruzcb.chamberwatch.store.MeasurementSet;

/**
 * Parses the two wafer measurement files. Columns are found by header name, because the files differ:
 * only the 9-point file has {@code loc_id}, and only the 89-point file has {@code postox_thickness_nan}.
 */
public final class MeasurementCsv {

	private static final Pattern EXPERIMENT_KEY = Pattern.compile("\\d{4}-\\d{2}-\\d{2}_\\d{2}");

	private static final List<String> COMMON = List.of("experiment_key", "X", "Y", "preox_thickness",
			"postox_thickness", "stepheight", "oxide_etch", "si_etch");

	private MeasurementCsv() {
	}

	/**
	 * @param records         rows with an experiment key, in file order
	 * @param skippedBlankKey rows with no experiment key, such as the last 9 rows of the 9-point file
	 */
	public record Parsed(List<MeasurementRecord> records, int skippedBlankKey) {
	}

	/** @throws IllegalStateException when a column is missing, a key is malformed, or a required number is blank */
	public static Parsed read(DataFiles.VerifiedFile csv, MeasurementSet set) {
		List<String> lines;
		try {
			lines = Files.readAllLines(csv.path(), StandardCharsets.UTF_8);
		}
		catch (IOException ex) {
			throw new UncheckedIOException(ex);
		}
		if (lines.isEmpty()) {
			throw new IllegalStateException(csv.path() + " is empty");
		}
		String[] header = fields(lines.get(0).replace("﻿", ""));
		Map<String, Integer> columns = new HashMap<>();
		for (int i = 0; i < header.length; i++) {
			columns.put(header[i], i);
		}
		List<String> required = new ArrayList<>(COMMON);
		required.add((set == MeasurementSet.NINE_POINT) ? "loc_id" : "postox_thickness_nan");
		for (String column : required) {
			if (!columns.containsKey(column)) {
				throw new IllegalStateException(csv.path() + " has no column " + column);
			}
		}
		List<MeasurementRecord> records = new ArrayList<>();
		Map<String, Integer> pointsSoFar = new HashMap<>();
		int skipped = 0;
		for (int lineNo = 2; lineNo <= lines.size(); lineNo++) {
			String line = lines.get(lineNo - 1);
			if (line.isBlank()) {
				continue;
			}
			Row row = new Row(csv, lineNo, fields(line), header.length, columns);
			String key = row.text("experiment_key");
			if (blank(key)) {
				skipped++;
				continue;
			}
			if (!EXPERIMENT_KEY.matcher(key).matches()) {
				throw new IllegalStateException(csv.path() + " line " + lineNo + ": not an experiment key: " + key);
			}
			int pointNo = pointsSoFar.merge(key, 1, Integer::sum);
			boolean nine = set == MeasurementSet.NINE_POINT;
			records.add(new MeasurementRecord(key, pointNo, nine ? Optional.of(row.required("loc_id")) : Optional.empty(),
					row.number("X"), row.number("Y"), row.number("preox_thickness"), row.number("postox_thickness"),
					nine || !blank(row.text("postox_thickness_nan")), row.number("stepheight"), row.number("oxide_etch"),
					row.number("si_etch")));
		}
		return new Parsed(records, skipped);
	}

	private static String[] fields(String line) {
		String[] fields = line.split(",", -1);
		for (int i = 0; i < fields.length; i++) {
			fields[i] = fields[i].strip();
		}
		return fields;
	}

	/** Empty, NaN, or N/A, which is how the 89-point file marks its 157 failed oxide readings. */
	private static boolean blank(String text) {
		return text.isEmpty() || text.equalsIgnoreCase("nan") || text.equalsIgnoreCase("n/a");
	}

	private record Row(DataFiles.VerifiedFile csv, int lineNo, String[] fields, int width, Map<String, Integer> columns) {

		Row {
			if (fields.length != width) {
				throw new IllegalStateException(csv.path() + " line " + lineNo + ": " + fields.length + " fields, expected " + width);
			}
		}

		String text(String column) {
			return fields[columns.get(column)];
		}

		String required(String column) {
			String text = text(column);
			if (blank(text)) {
				throw new IllegalStateException(csv.path() + " line " + lineNo + ": " + column + " is blank");
			}
			return text;
		}

		double number(String column) {
			String text = required(column);
			try {
				return Double.parseDouble(text);
			}
			catch (NumberFormatException ex) {
				throw new IllegalStateException(csv.path() + " line " + lineNo + ": " + column + " is not a number: " + text, ex);
			}
		}

	}

}
