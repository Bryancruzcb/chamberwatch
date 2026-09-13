package io.github.bryancruzcb.chamberwatch.recipe;

import java.time.DateTimeException;
import java.time.LocalDate;
import java.util.Locale;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The natural identity of a run, stable across re-ingests. Public runs are spelled like their netCDF
 * group, {@code Day_2024_07_02_Wafer_01}. Synthetic runs are spelled {@code SIM-s7-L901-W03} for
 * seed 7, lot 901, wafer 3. Both spellings are parsed here and nowhere else.
 *
 * @param positionInLot the wafer number, counted from the chamber clean
 */
public record RunKey(String value, Source source, int positionInLot) implements Comparable<RunKey> {

	private static final Pattern PUBLIC = Pattern.compile("Day_(\\d{4})_(\\d{2})_(\\d{2})_Wafer_(\\d{2})");

	private static final Pattern SYNTHETIC = Pattern.compile("SIM-s(-?\\d+)-L(\\d+)-W(\\d{2})");

	public RunKey {
		if (value == null || source == null) {
			throw new IllegalArgumentException("run key needs a value and a source");
		}
		Matcher matcher = (source == Source.PUBLIC ? PUBLIC : SYNTHETIC).matcher(value);
		int positionGroup = source == Source.PUBLIC ? 4 : 3;
		if (!matcher.matches() || positionInLot < 1 || Integer.parseInt(matcher.group(positionGroup)) != positionInLot) {
			throw new IllegalArgumentException("not a " + source + " run key: " + value);
		}
	}

	/** @throws IllegalArgumentException when the name is not {@code Day_YYYY_MM_DD_Wafer_NN} with a real date */
	public static RunKey ofPublicGroup(String groupName) {
		Matcher matcher = groupName == null ? null : PUBLIC.matcher(groupName);
		if (matcher == null || !matcher.matches()) {
			throw new IllegalArgumentException("not a wafer group name: " + groupName);
		}
		dayOf(matcher);
		return new RunKey(groupName, Source.PUBLIC, Integer.parseInt(matcher.group(4)));
	}

	public static RunKey simulated(long seed, int lotNo, int positionInLot) {
		if (lotNo < 1 || positionInLot < 1 || positionInLot > 99) {
			throw new IllegalArgumentException("invalid simulated lot " + lotNo + " wafer " + positionInLot);
		}
		String value = String.format(Locale.ROOT, "SIM-s%d-L%d-W%02d", seed, lotNo, positionInLot);
		return new RunKey(value, Source.SYNTHETIC, positionInLot);
	}

	/** The lot's day for public runs, empty for synthetic runs. */
	public Optional<LocalDate> day() {
		if (source != Source.PUBLIC) {
			return Optional.empty();
		}
		Matcher matcher = PUBLIC.matcher(value);
		matcher.matches();
		return Optional.of(dayOf(matcher));
	}

	/** The measurement files' {@code experiment_key}, {@code YYYY-MM-DD_NN}, for public runs. */
	public Optional<String> experimentKey() {
		return day().map(day -> day + "_" + String.format(Locale.ROOT, "%02d", positionInLot));
	}

	@Override
	public int compareTo(RunKey other) {
		return value.compareTo(other.value);
	}

	private static LocalDate dayOf(Matcher matcher) {
		try {
			return LocalDate.of(Integer.parseInt(matcher.group(1)), Integer.parseInt(matcher.group(2)),
					Integer.parseInt(matcher.group(3)));
		}
		catch (DateTimeException ex) {
			throw new IllegalArgumentException("not a real date in " + matcher.group(), ex);
		}
	}

}
