package io.github.bryancruzcb.chamberwatch.ingest;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class DataFilesTest {

	private static final String HELLO_MD5 = "b1946ac92492d2347c6235b4d2611184";

	@TempDir
	Path dir;

	@Test
	void aFileMatchingItsListedChecksumIsVerified() throws IOException {
		Files.writeString(dir.resolve("a.csv"), "hello\n");
		Files.writeString(dir.resolve("sums.md5"), HELLO_MD5 + "  a.csv\n");

		DataFiles.VerifiedFile file = DataFiles.verify(dir, dir.resolve("sums.md5"), List.of("a.csv")).get("a.csv");

		assertThat(file.md5()).isEqualTo(HELLO_MD5);
		assertThat(file.bytes()).isEqualTo(6);
	}

	@Test
	void aChangedFileIsRejected() throws IOException {
		Files.writeString(dir.resolve("a.csv"), "changed\n");
		Files.writeString(dir.resolve("sums.md5"), HELLO_MD5 + "  a.csv\n");

		assertThatThrownBy(() -> DataFiles.verify(dir, dir.resolve("sums.md5"), List.of("a.csv")))
			.isInstanceOf(DataFiles.ChecksumMismatch.class)
			.hasMessageContaining(HELLO_MD5);
	}

	@Test
	void aFileMissingFromTheListIsRejected() throws IOException {
		Files.writeString(dir.resolve("sums.md5"), HELLO_MD5 + "  a.csv\n");

		assertThatIllegalArgumentException()
			.isThrownBy(() -> DataFiles.verify(dir, dir.resolve("sums.md5"), List.of("b.csv")));
	}

}
