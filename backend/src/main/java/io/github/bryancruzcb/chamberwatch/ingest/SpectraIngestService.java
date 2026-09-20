package io.github.bryancruzcb.chamberwatch.ingest;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import io.github.bryancruzcb.chamberwatch.recipe.AlignedRun;
import io.github.bryancruzcb.chamberwatch.recipe.RecipeGrid;
import io.github.bryancruzcb.chamberwatch.recipe.RunKey;
import io.github.bryancruzcb.chamberwatch.spectra.EmissionLines;
import io.github.bryancruzcb.chamberwatch.spectra.NetcdfSpectraSource;
import io.github.bryancruzcb.chamberwatch.spectra.SpectraReduction;
import io.github.bryancruzcb.chamberwatch.spectra.WaferSpectra;
import io.github.bryancruzcb.chamberwatch.store.RunStore;

import org.springframework.stereotype.Service;

/**
 * Loads the dataset's optical emission spectra as channels of the wafers already stored: one daily file at a
 * time, one wafer at a time, each wafer's own transaction.
 *
 * <p>The spectra are 7.9 GB against the telemetry's 8.8 MB, so this is a job a reader starts on purpose, never
 * part of serving. It resumes by what is in the database rather than by a checkpoint of its own: a file whose
 * checksum the ledger holds for this reduction is skipped whole, and inside a file a wafer that already carries
 * this reduction's channels is skipped too, so a rerun reads nothing and a new reduction replaces what the old
 * one wrote.
 *
 * <p>A wafer whose emission record cannot be placed, or whose record has gaps through the etch, is left with no
 * emission channels at all rather than with thin ones. A thin record makes noisy slot means, and noisy slot means
 * would teach the detectors a spread that the chamber never had.
 */
@Service
public class SpectraIngestService {

	static final String DICTIONARY = "Dictionary_OES.nc";

	/** The ten daily files, in the order they were recorded. */
	static final List<String> DAILY_FILES = List.of("Day_2024_07_02.nc", "Day_2024_07_05.nc", "Day_2024_07_09.nc",
			"Day_2024_07_11.nc", "Day_2024_07_19.nc", "Day_2024_08_01.nc", "Day_2024_08_05.nc", "Day_2024_08_07.nc",
			"Day_2024_08_21.nc", "Day_2024_08_22.nc");

	private final RunStore runs;

	public SpectraIngestService(RunStore runs) {
		this.runs = runs;
	}

	/** What one file's wafers came to. */
	public record FileLoad(String file, boolean alreadyLoaded, int stored, int present, int thin, int unplaceable,
			int notIngested) {

		public String describe() {
			if (alreadyLoaded) {
				return file + ": already loaded, nothing read";
			}
			return file + ": " + stored + " stored, " + present + " already there, " + thin + " too thin, "
					+ unplaceable + " unplaceable, " + notIngested + " without telemetry";
		}

	}

	/** What the whole job came to. */
	public record SpectraReport(List<FileLoad> files) {

		public SpectraReport {
			files = List.copyOf(files);
		}

		public int stored() {
			return files.stream().mapToInt(FileLoad::stored).sum();
		}

		public int left() {
			return files.stream().mapToInt((file) -> file.thin() + file.unplaceable()).sum();
		}

		public String describe() {
			List<String> lines = new ArrayList<>(files.stream().map(FileLoad::describe).toList());
			lines.add("spectra reduction " + EmissionLines.VERSION + ": " + stored() + " wafers stored, " + left()
					+ " left without emission channels");
			return String.join("\n", lines);
		}

	}

	/**
	 * Reduces every daily file in the directory and stores what it can.
	 *
	 * @param dataDir where the dataset was downloaded
	 * @param md5List the checksums every file is checked against before it is read
	 */
	public SpectraReport ingest(Path dataDir, Path md5List) {
		List<String> wanted = new ArrayList<>(DAILY_FILES);
		wanted.add(DICTIONARY);
		Map<String, DataFiles.VerifiedFile> files = DataFiles.verify(dataDir, md5List, wanted);
		List<FileLoad> loads = new ArrayList<>();
		for (String daily : DAILY_FILES) {
			loads.add(load(files.get(daily), files.get(DICTIONARY)));
		}
		return new SpectraReport(loads);
	}

	private FileLoad load(DataFiles.VerifiedFile daily, DataFiles.VerifiedFile dictionary) {
		String name = daily.path().getFileName().toString();
		if (runs.ledger(daily.md5(), EmissionLines.VERSION) == RunStore.LedgerStatus.COMPLETE) {
			return new FileLoad(name, true, 0, 0, 0, 0, 0);
		}
		runs.markStarted(daily.md5(), EmissionLines.VERSION, name, daily.bytes());
		int stored = 0;
		int present = 0;
		int thin = 0;
		int unplaceable = 0;
		int notIngested = 0;
		try (NetcdfSpectraSource source = NetcdfSpectraSource.open(daily.path(), dictionary.path())) {
			for (RunKey key : source.keys()) {
				Optional<RunStore.StoredRun> run = runs.find(key);
				if (run.isEmpty()) {
					notIngested++;
					continue;
				}
				if (run.get().spectraVersion() == EmissionLines.VERSION) {
					present++;
					continue;
				}
				AlignedRun telemetry = runs.loadAligned(run.get().id());
				WaferSpectra record = source.read(key, NetcdfSpectraSource.standardLines());
				Optional<SpectraReduction.Reduced> reduced = SpectraReduction.reduce(record,
						telemetry.copySlotTimes(), RecipeGrid.STANDARD, telemetry.report().etchStartS());
				if (reduced.isEmpty()) {
					unplaceable++;
					continue;
				}
				if (!reduced.get().report().usable()) {
					thin++;
					continue;
				}
				runs.putSlotChannels(run.get().id(), reduced.get().values(), EmissionLines.VERSION);
				stored++;
			}
		}
		runs.markComplete(daily.md5(), EmissionLines.VERSION);
		return new FileLoad(name, false, stored, present, thin, unplaceable, notIngested);
	}

}
