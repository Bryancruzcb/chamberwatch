package io.github.bryancruzcb.chamberwatch.health;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.SortedSet;

import io.github.bryancruzcb.chamberwatch.detect.Baseline;
import io.github.bryancruzcb.chamberwatch.detect.DetectorConfig;
import io.github.bryancruzcb.chamberwatch.detect.GoodRuns;
import io.github.bryancruzcb.chamberwatch.detect.HealthModel;
import io.github.bryancruzcb.chamberwatch.recipe.AlignedRun;
import io.github.bryancruzcb.chamberwatch.recipe.Aligner;
import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;
import io.github.bryancruzcb.chamberwatch.recipe.RunKey;
import io.github.bryancruzcb.chamberwatch.recipe.Source;
import io.github.bryancruzcb.chamberwatch.store.BaselineRef;
import io.github.bryancruzcb.chamberwatch.store.BaselineStore;
import io.github.bryancruzcb.chamberwatch.store.Fingerprint;
import io.github.bryancruzcb.chamberwatch.store.RunId;
import io.github.bryancruzcb.chamberwatch.store.RunRoster;
import io.github.bryancruzcb.chamberwatch.store.RunStore;

import org.springframework.stereotype.Service;

/** Keeps each source's baseline and assessments in line with its runs and labels, and is the only code that writes them. */
@Service
public class HealthService {

	/** Baselines kept per source, counting the current one. */
	static final int GENERATIONS_KEPT = 3;

	private final RunStore runs;

	private final BaselineStore baselines;

	private final DetectorConfig config;

	public HealthService(RunStore runs, BaselineStore baselines, DetectorConfig config) {
		this.runs = runs;
		this.baselines = baselines;
		this.config = config;
	}

	/**
	 * Chooses the good runs again, reuses the stored baseline when they and the settings are unchanged or fits a
	 * new one, scores every run without an assessment under it, and makes it current. Nothing is remembered
	 * between calls, so it converges from any state, after a crash as well as after an ingest or a relabel, and a
	 * call that finds everything in place writes nothing.
	 */
	public Refresh refresh(Source source) {
		RunRoster roster = runs.roster(source);
		SortedSet<RunKey> good = GoodRuns.select(roster.candidates(), config.goodRunsPerLot());
		if (good.isEmpty()) {
			return Refresh.nothingToFit(source);
		}
		Map<RunKey, RunId> ids = roster.ids();
		// a run can gain channels after it was stored, as it does when the spectra are reduced into it
		SortedSet<ChannelName> channels = runs.channelsOf(good.stream().map(ids::get).toList());
		Fingerprint fingerprint = Fingerprint.of(source, good, channels, config, Aligner.VERSION,
				HealthModel.VERSION);
		Optional<BaselineRef> stored = baselines.find(fingerprint);
		BaselineRef baseline;
		Baseline model = null;
		if (stored.isPresent()) {
			baseline = stored.get();
		}
		else {
			model = HealthModel.fit(good.stream().map((key) -> runs.loadAligned(ids.get(key))), config);
			baseline = baselines.insert(source, fingerprint, roster.labelsSeq(), model, ids);
		}
		int scored = 0;
		List<RunId> unscored = baselines.unscored(baseline);
		if (!unscored.isEmpty()) {
			if (model == null) {
				model = baselines.load(baseline, config);
			}
			for (RunId id : unscored) {
				AlignedRun run = runs.loadAligned(id);
				if (baselines.insertAssessment(baseline, id, run, HealthModel.assess(run, model))) {
					scored++;
				}
			}
		}
		boolean current = baselines.makeCurrent(baseline, roster.labelsSeq());
		int pruned = baselines.prune(source, GENERATIONS_KEPT);
		return new Refresh(source, Optional.of(baseline), stored.isEmpty(), scored, baselines.flaggedRuns(baseline),
				current, pruned);
	}

}
