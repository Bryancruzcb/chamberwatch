package io.github.bryancruzcb.chamberwatch.ingest;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.time.LocalDate;
import java.time.Month;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

import javax.xml.stream.XMLInputFactory;
import javax.xml.stream.XMLStreamConstants;
import javax.xml.stream.XMLStreamException;
import javax.xml.stream.XMLStreamReader;

import io.github.bryancruzcb.chamberwatch.recipe.Source;
import io.github.bryancruzcb.chamberwatch.store.LotRecord;

/**
 * Reads the lot table from {@code Lot_status.xlsx} with {@code java.util.zip} and StAX. A spreadsheet
 * library would be the largest dependency in the build, for ten rows.
 *
 * <p>The sheet keeps its text in shared strings. Dates are text such as "2th July 2024" and "1st Aug
 * 2024", and conditioning codes such as "1C - Si " carry stray spaces. The sheet also holds a second
 * table of failed readings, whose rows do not start with "Lot N" and are skipped.
 */
public final class LotSheet {

	private static final String SHEET = "xl/worksheets/sheet1.xml";

	private static final String SHARED_STRINGS = "xl/sharedStrings.xml";

	private static final Pattern LOT = Pattern.compile("Lot (\\d+)");

	private static final Pattern DATE = Pattern.compile("(\\d{1,2})(?:st|nd|rd|th)\\s+([A-Za-z]{3,})\\s+(\\d{4})");

	private static final Pattern CONDITIONING = Pattern.compile("(\\d+)C(?:\\s*-\\s*(SiO2|Si))?");

	private LotSheet() {
	}

	/**
	 * @return the public lots, sorted by number
	 * @throws IllegalStateException when the header, a date or a conditioning code does not parse, or a lot repeats
	 */
	public static List<LotRecord> read(DataFiles.VerifiedFile lotStatus) {
		try (ZipFile zip = new ZipFile(lotStatus.path().toFile())) {
			List<Map<String, String>> rows = rows(zip, sharedStrings(zip));
			Map<String, String> columns = headerColumns(rows);
			List<LotRecord> lots = new ArrayList<>();
			Set<Integer> seen = new HashSet<>();
			for (Map<String, String> row : rows) {
				Matcher lot = LOT.matcher(row.getOrDefault(columns.get("Lot No."), "").strip());
				if (!lot.matches()) {
					continue;
				}
				int lotNo = Integer.parseInt(lot.group(1));
				if (!seen.add(lotNo)) {
					throw new IllegalStateException("lot " + lotNo + " appears twice in " + lotStatus.path());
				}
				lots.add(new LotRecord(Source.PUBLIC, lotNo, Optional.of(date(row.get(columns.get("Date")))),
						Optional.of(conditioning(row.get(columns.get("Type"))))));
			}
			if (lots.isEmpty()) {
				throw new IllegalStateException("no lots found in " + lotStatus.path());
			}
			lots.sort(Comparator.comparingInt(LotRecord::lotNo));
			return lots;
		}
		catch (IOException ex) {
			throw new UncheckedIOException(ex);
		}
		catch (XMLStreamException ex) {
			throw new IllegalStateException("unreadable workbook " + lotStatus.path(), ex);
		}
	}

	static LocalDate date(String text) {
		Matcher matcher = DATE.matcher((text == null) ? "" : text.strip());
		if (!matcher.matches()) {
			throw new IllegalStateException("not a lot date: " + text);
		}
		String prefix = matcher.group(2).substring(0, 3).toUpperCase(Locale.ROOT);
		Month month = Arrays.stream(Month.values())
			.filter((candidate) -> candidate.name().startsWith(prefix))
			.findFirst()
			.orElseThrow(() -> new IllegalStateException("not a month in lot date: " + text));
		return LocalDate.of(Integer.parseInt(matcher.group(3)), month, Integer.parseInt(matcher.group(1)));
	}

	static LotRecord.Conditioning conditioning(String text) {
		Matcher matcher = CONDITIONING.matcher((text == null) ? "" : text.strip());
		if (!matcher.matches()) {
			throw new IllegalStateException("not a conditioning code: " + text);
		}
		LotRecord.Surface surface = (matcher.group(2) == null) ? LotRecord.Surface.CHUCK
				: matcher.group(2).equals("Si") ? LotRecord.Surface.SILICON : LotRecord.Surface.OXIDE;
		return new LotRecord.Conditioning(Integer.parseInt(matcher.group(1)), surface);
	}

	/** Column letter by header text, from the first row that holds the lot table's header. */
	private static Map<String, String> headerColumns(List<Map<String, String>> rows) {
		for (Map<String, String> row : rows) {
			Map<String, String> columns = new HashMap<>();
			row.forEach((column, text) -> columns.put(text.strip(), column));
			if (columns.keySet().containsAll(List.of("Lot No.", "Date", "Type"))) {
				return columns;
			}
		}
		throw new IllegalStateException("lot sheet has no header with Lot No., Date and Type");
	}

	private static List<String> sharedStrings(ZipFile zip) throws IOException, XMLStreamException {
		ZipEntry entry = zip.getEntry(SHARED_STRINGS);
		List<String> strings = new ArrayList<>();
		if (entry == null) {
			return strings;
		}
		try (InputStream in = zip.getInputStream(entry)) {
			XMLStreamReader xml = xmlInput().createXMLStreamReader(in);
			StringBuilder current = null;
			boolean inText = false;
			while (xml.hasNext()) {
				int event = xml.next();
				if (event == XMLStreamConstants.START_ELEMENT) {
					switch (xml.getLocalName()) {
						case "si" -> current = new StringBuilder();
						case "t" -> inText = true;
						default -> {
						}
					}
				}
				else if (event == XMLStreamConstants.CHARACTERS && inText && current != null) {
					current.append(xml.getText());
				}
				else if (event == XMLStreamConstants.END_ELEMENT) {
					switch (xml.getLocalName()) {
						case "t" -> inText = false;
						case "si" -> strings.add(current.toString());
						default -> {
						}
					}
				}
			}
			xml.close();
		}
		return strings;
	}

	/** Every row of the first sheet as column letter to cell text, shared strings resolved. */
	private static List<Map<String, String>> rows(ZipFile zip, List<String> strings)
			throws IOException, XMLStreamException {
		ZipEntry entry = zip.getEntry(SHEET);
		if (entry == null) {
			throw new IllegalStateException("workbook has no " + SHEET);
		}
		List<Map<String, String>> rows = new ArrayList<>();
		try (InputStream in = zip.getInputStream(entry)) {
			XMLStreamReader xml = xmlInput().createXMLStreamReader(in);
			Map<String, String> row = null;
			String column = null;
			String type = null;
			StringBuilder value = null;
			boolean capture = false;
			while (xml.hasNext()) {
				int event = xml.next();
				if (event == XMLStreamConstants.START_ELEMENT) {
					switch (xml.getLocalName()) {
						case "row" -> row = new HashMap<>();
						case "c" -> {
							column = xml.getAttributeValue(null, "r").replaceAll("\\d", "");
							type = xml.getAttributeValue(null, "t");
							value = new StringBuilder();
						}
						case "v", "t" -> capture = true;
						default -> {
						}
					}
				}
				else if (event == XMLStreamConstants.CHARACTERS && capture && value != null) {
					value.append(xml.getText());
				}
				else if (event == XMLStreamConstants.END_ELEMENT) {
					switch (xml.getLocalName()) {
						case "v", "t" -> capture = false;
						case "c" -> row.put(column,
								"s".equals(type) ? strings.get(Integer.parseInt(value.toString().strip())) : value.toString());
						case "row" -> rows.add(row);
						default -> {
						}
					}
				}
			}
			xml.close();
		}
		return rows;
	}

	private static XMLInputFactory xmlInput() {
		XMLInputFactory factory = XMLInputFactory.newFactory();
		factory.setProperty(XMLInputFactory.SUPPORT_DTD, false);
		factory.setProperty(XMLInputFactory.IS_SUPPORTING_EXTERNAL_ENTITIES, false);
		return factory;
	}

}
