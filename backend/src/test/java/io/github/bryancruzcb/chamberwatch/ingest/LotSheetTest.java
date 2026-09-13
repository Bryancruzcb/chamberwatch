package io.github.bryancruzcb.chamberwatch.ingest;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDate;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import io.github.bryancruzcb.chamberwatch.recipe.Source;
import io.github.bryancruzcb.chamberwatch.store.LotRecord;
import io.github.bryancruzcb.chamberwatch.store.LotRecord.Conditioning;
import io.github.bryancruzcb.chamberwatch.store.LotRecord.Surface;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalStateException;

class LotSheetTest {

	private static final String MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

	@TempDir
	Path dir;

	@Test
	void lotRowsAreReadWithTheirDatesAndConditioning() throws Exception {
		DataFiles.VerifiedFile file = workbook("""
				<si><t>Lot No.</t></si><si><t>Date</t></si><si><t>Type</t></si>
				<si><t>Lot 7</t></si><si><t>5th Aug 2024</t></si><si><t>3C - SiO2</t></si>
				<si><t>Lot 1</t></si><si><t>2th July 2024</t></si><si><t xml:space="preserve">3C </t></si>
				<si><t>Lot 5</t></si><si><t>19th July 2024</t></si><si><t xml:space="preserve">1C - Si </t></si>
				<si><t>Lot</t></si>""", """
				<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="E1" t="s"><v>2</v></c></row>
				<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" t="s"><v>4</v></c><c r="C2"><v>6</v></c><c r="E2" t="s"><v>5</v></c></row>
				<row r="3"><c r="A3" t="s"><v>6</v></c><c r="B3" t="s"><v>7</v></c><c r="C3"><v>10</v></c><c r="E3" t="s"><v>8</v></c></row>
				<row r="4"><c r="A4" t="s"><v>9</v></c><c r="B4" t="s"><v>10</v></c><c r="E4" t="s"><v>11</v></c></row>
				<row r="5"><c r="A5" t="s"><v>12</v></c></row>
				<row r="6"><c r="A6"><v>3</v></c><c r="B6"><v>4</v></c></row>""");

		List<LotRecord> lots = LotSheet.read(file);

		assertThat(lots).containsExactly(
				new LotRecord(Source.PUBLIC, 1, Optional.of(LocalDate.of(2024, 7, 2)), Optional.of(new Conditioning(3, Surface.CHUCK))),
				new LotRecord(Source.PUBLIC, 5, Optional.of(LocalDate.of(2024, 7, 19)), Optional.of(new Conditioning(1, Surface.SILICON))),
				new LotRecord(Source.PUBLIC, 7, Optional.of(LocalDate.of(2024, 8, 5)), Optional.of(new Conditioning(3, Surface.OXIDE))));
	}

	@Test
	void datesAndConditioningCodesWithTheSheetsQuirksParse() {
		assertThat(LotSheet.date("22nd Aug 2024")).isEqualTo(LocalDate.of(2024, 8, 22));
		assertThat(LotSheet.date(" 1st Aug 2024 ")).isEqualTo(LocalDate.of(2024, 8, 1));
		assertThat(LotSheet.conditioning("9C - Si")).isEqualTo(new Conditioning(9, Surface.SILICON));
		assertThatIllegalStateException().isThrownBy(() -> LotSheet.date("July 2024"));
		assertThatIllegalStateException().isThrownBy(() -> LotSheet.conditioning("3X"));
	}

	private DataFiles.VerifiedFile workbook(String sharedStrings, String rows) throws IOException, NoSuchAlgorithmException {
		Path xlsx = dir.resolve("Lot_status.xlsx");
		try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(xlsx))) {
			entry(zip, "xl/sharedStrings.xml", "<sst xmlns=\"" + MAIN + "\">" + sharedStrings + "</sst>");
			entry(zip, "xl/worksheets/sheet1.xml",
					"<worksheet xmlns=\"" + MAIN + "\"><sheetData>" + rows + "</sheetData></worksheet>");
		}
		String md5 = HexFormat.of().formatHex(MessageDigest.getInstance("MD5").digest(Files.readAllBytes(xlsx)));
		Files.writeString(dir.resolve("sums.md5"), md5 + "  Lot_status.xlsx\n");
		return DataFiles.verify(dir, dir.resolve("sums.md5"), List.of("Lot_status.xlsx")).get("Lot_status.xlsx");
	}

	private static void entry(ZipOutputStream zip, String name, String content) throws IOException {
		zip.putNextEntry(new ZipEntry(name));
		OutputStream out = zip;
		out.write(content.getBytes(StandardCharsets.UTF_8));
		zip.closeEntry();
	}

}
