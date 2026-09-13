package io.github.bryancruzcb.chamberwatch.store;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.stream.Collectors;

import javax.sql.DataSource;

import io.github.bryancruzcb.chamberwatch.detect.Baseline;
import io.github.bryancruzcb.chamberwatch.detect.ChannelBand;
import io.github.bryancruzcb.chamberwatch.detect.ChannelRole;
import io.github.bryancruzcb.chamberwatch.detect.ChannelVerdict;
import io.github.bryancruzcb.chamberwatch.detect.DetectorConfig;
import io.github.bryancruzcb.chamberwatch.detect.Excursion;
import io.github.bryancruzcb.chamberwatch.detect.HealthModel;
import io.github.bryancruzcb.chamberwatch.detect.RunAssessment;
import io.github.bryancruzcb.chamberwatch.detect.SummaryBand;
import io.github.bryancruzcb.chamberwatch.detect.SummaryBands;
import io.github.bryancruzcb.chamberwatch.detect.SummaryStat;
import io.github.bryancruzcb.chamberwatch.recipe.AlignedRun;
import io.github.bryancruzcb.chamberwatch.recipe.Aligner;
import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;
import io.github.bryancruzcb.chamberwatch.recipe.Phase;
import io.github.bryancruzcb.chamberwatch.recipe.RecipeGrid;
import io.github.bryancruzcb.chamberwatch.recipe.RunKey;
import io.github.bryancruzcb.chamberwatch.recipe.Source;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Baselines, their bands, and the assessments scored against them. Every row carries its baseline id, so a
 * refit writes new rows beside the old ones and only the current pointer is ever contended.
 */
@Repository
public class BaselineStore {

	private static final String COPY_BANDS = "copy band (baseline_id, channel_id, slot, mean, sd) from stdin (format csv)";

	private static final String SELECT_REF = """
			select b.id, b.source, (select count(*) from baseline_good_run g where g.baseline_id = b.id) as good_runs
			from baseline b
			""";

	private final JdbcClient jdbc;

	private final JdbcTemplate jdbcTemplate;

	private final DataSource dataSource;

	private final TransactionTemplate transactions;

	public BaselineStore(JdbcClient jdbc, JdbcTemplate jdbcTemplate, DataSource dataSource,
			TransactionTemplate transactions) {
		this.jdbc = jdbc;
		this.jdbcTemplate = jdbcTemplate;
		this.dataSource = dataSource;
		this.transactions = transactions;
	}

	public Optional<BaselineRef> find(Fingerprint fingerprint) {
		return jdbc.sql(SELECT_REF + "where b.fingerprint = :fingerprint")
			.param("fingerprint", fingerprint.hex())
			.query((rs, row) -> new BaselineRef(rs.getInt("id"), Source.valueOf(rs.getString("source")), rs.getInt("good_runs")))
			.optional();
	}

	public Optional<BaselineRef> current(Source source) {
		return jdbc.sql(SELECT_REF + "join current_baseline c on c.baseline_id = b.id where c.source = :source")
			.param("source", source.name())
			.query((rs, row) -> new BaselineRef(rs.getInt("id"), Source.valueOf(rs.getString("source")), rs.getInt("good_runs")))
			.optional();
	}

	/**
	 * Stores a fitted baseline in one transaction: the baseline row, its good runs, a role per channel, every
	 * band and every summary band. When another refresh stored the same fingerprint first, nothing is written
	 * and that baseline is returned.
	 *
	 * @param runIds the stored id of every good run
	 */
	public BaselineRef insert(Source source, Fingerprint fingerprint, long labelsSeq, Baseline baseline,
			Map<RunKey, RunId> runIds) {
		Map<ChannelName, Short> channelIds = channelIds();
		return Objects.requireNonNull(transactions.execute((status) -> {
			DetectorConfig config = baseline.config();
			Optional<Integer> inserted = jdbc.sql("""
					insert into baseline (source, fingerprint, aligner_version, detector_version, labels_seq,
					                      pool_half_width, relative_sd_floor, min_observations, max_distinct_tracked,
					                      limit_k, limit_n, run_z)
					values (:source, :fingerprint, :alignerVersion, :detectorVersion, :labelsSeq, :poolHalfWidth,
					        :relativeSdFloor, :minObservations, :maxDistinctTracked, :k, :n, :runZ)
					on conflict (fingerprint) do nothing
					returning id""")
				.param("source", source.name())
				.param("fingerprint", fingerprint.hex())
				.param("alignerVersion", Aligner.VERSION)
				.param("detectorVersion", HealthModel.VERSION)
				.param("labelsSeq", labelsSeq)
				.param("poolHalfWidth", config.band().poolHalfWidthCycles())
				.param("relativeSdFloor", config.band().relativeSdFloor())
				.param("minObservations", config.band().minObservations())
				.param("maxDistinctTracked", config.band().maxDistinctTracked())
				.param("k", config.limit().k())
				.param("n", config.limit().n())
				.param("runZ", config.runZ())
				.query(Integer.class)
				.optional();
			if (inserted.isEmpty()) {
				return find(fingerprint).orElseThrow();
			}
			int id = inserted.get();
			jdbcTemplate.batchUpdate("insert into baseline_good_run (baseline_id, run_id) values (?, ?)",
					baseline.goodRuns().stream().map((key) -> new Object[] { id, storedId(runIds, key) }).toList());
			jdbcTemplate.batchUpdate(
					"insert into baseline_channel (baseline_id, channel_id, role, good_runs) values (?, ?, ?, ?)",
					baseline.bands()
						.values()
						.stream()
						.map((band) -> new Object[] { id, channelIds.get(band.channel()), band.role().name(), band.goodRuns() })
						.toList());
			copyBands(id, baseline, channelIds);
			jdbcTemplate.batchUpdate("""
					insert into summary_band (baseline_id, channel_id, phase, stat, mean, sd)
					values (?, ?, ?, ?, ?, ?)""", baseline.summaryBands()
				.asMap()
				.entrySet()
				.stream()
				.map((entry) -> new Object[] { id, channelIds.get(entry.getKey().channel()), entry.getKey().phase().name(),
						entry.getKey().stat().name(), entry.getValue().mean(), entry.getValue().sd() })
				.toList());
			return new BaselineRef(id, source, baseline.goodRuns().size());
		}));
	}

	/**
	 * Loads a stored baseline for scoring.
	 *
	 * @param config the settings its fingerprint was made with
	 */
	public Baseline load(BaselineRef ref, DetectorConfig config) {
		RecipeGrid grid = RecipeGrid.STANDARD;
		Map<Short, ChannelName> names = channelNames();
		List<RunKey> goodRuns = jdbc.sql("""
				select r.run_key, l.source, r.position_in_lot
				from baseline_good_run g
				join run r on r.id = g.run_id
				join lot l on l.id = r.lot_id
				where g.baseline_id = :baseline""")
			.param("baseline", ref.id())
			.query((rs, row) -> new RunKey(rs.getString("run_key"), Source.valueOf(rs.getString("source")),
					rs.getInt("position_in_lot")))
			.list();
		record Role(ChannelName channel, ChannelRole role, int goodRuns) {
		}
		List<Role> roles = jdbc.sql("select channel_id, role, good_runs from baseline_channel where baseline_id = :baseline")
			.param("baseline", ref.id())
			.query((rs, row) -> new Role(names.get(rs.getShort("channel_id")), ChannelRole.valueOf(rs.getString("role")),
					rs.getInt("good_runs")))
			.list();
		Map<ChannelName, float[]> means = new HashMap<>();
		Map<ChannelName, float[]> sds = new HashMap<>();
		for (Role role : roles) {
			means.put(role.channel(), emptyProfile(grid));
			sds.put(role.channel(), emptyProfile(grid));
		}
		jdbcTemplate.query("select channel_id, slot, mean, sd from band where baseline_id = ?", (RowCallbackHandler) (rs) -> {
			ChannelName channel = names.get(rs.getShort(1));
			int slot = rs.getShort(2);
			means.get(channel)[slot] = rs.getFloat(3);
			float sd = rs.getFloat(4);
			if (!rs.wasNull()) {
				sds.get(channel)[slot] = sd;
			}
		}, ref.id());
		Map<ChannelName, ChannelBand> bands = new HashMap<>();
		for (Role role : roles) {
			bands.put(role.channel(), ChannelBand.adopt(role.channel(), role.role(), role.goodRuns(),
					means.get(role.channel()), sds.get(role.channel())));
		}
		Map<SummaryBands.Key, SummaryBand> summaryBands = new HashMap<>();
		jdbc.sql("select channel_id, phase, stat, mean, sd from summary_band where baseline_id = :baseline")
			.param("baseline", ref.id())
			.query((rs, row) -> Map.entry(
					new SummaryBands.Key(names.get(rs.getShort("channel_id")), Phase.valueOf(rs.getString("phase")),
							SummaryStat.valueOf(rs.getString("stat"))),
					new SummaryBand(rs.getDouble("mean"), rs.getDouble("sd"))))
			.list()
			.forEach((entry) -> summaryBands.put(entry.getKey(), entry.getValue()));
		return Baseline.adopt(grid, config, goodRuns, bands, SummaryBands.of(summaryBands));
	}

	/** Stored runs of the baseline's source that can be scored and have no assessment under it, in key order. */
	public List<RunId> unscored(BaselineRef baseline) {
		return jdbc.sql("""
				select r.id
				from run r
				join lot l on l.id = r.lot_id
				where l.source = :source
				  and r.alignment_status <> 'FAILED'
				  and not exists (select 1 from run_assessment a where a.baseline_id = :baseline and a.run_id = r.id)
				order by r.run_key""")
			.param("source", baseline.source().name())
			.param("baseline", baseline.id())
			.query((rs, row) -> new RunId(rs.getInt("id")))
			.list();
	}

	/**
	 * Stores one run's assessment with its verdicts and excursions, in one transaction. A run already assessed
	 * under this baseline is left as it is.
	 *
	 * @return whether anything was written
	 */
	public boolean insertAssessment(BaselineRef baseline, RunId runId, AlignedRun run, RunAssessment assessment) {
		Map<ChannelName, Short> channelIds = channelIds();
		return Boolean.TRUE.equals(transactions.execute((status) -> {
			Optional<ChannelVerdict> first = assessment.verdicts().stream().findFirst().filter(ChannelVerdict::flagged);
			Optional<Excursion> excursion = assessment.firstExcursion();
			Map<String, Object> params = new HashMap<>();
			params.put("baseline", baseline.id());
			params.put("run", runId.value());
			params.put("limitFlags", assessment.limitFlags());
			params.put("deviationFlags", assessment.deviationFlags());
			params.put("maxPersistentZ", assessment.maxPersistentZ());
			params.put("firstChannel", first.map((verdict) -> channelIds.get(verdict.channel())).orElse(null));
			params.put("startSlot", excursion.map(Excursion::startSlot).orElse(null));
			params.put("confirmSlot", excursion.map(Excursion::confirmSlot).orElse(null));
			params.put("timeS", excursion.map((e) -> (float) run.timeAt(e.startSlot())).orElse(null));
			int inserted = jdbc.sql("""
					insert into run_assessment (baseline_id, run_id, limit_flags, deviation_flags, max_persistent_z,
					                            first_channel_id, first_start_slot, first_confirm_slot, first_time_s)
					values (:baseline, :run, :limitFlags, :deviationFlags, :maxPersistentZ, :firstChannel, :startSlot,
					        :confirmSlot, :timeS)
					on conflict do nothing""")
				.params(params)
				.update();
			if (inserted == 0) {
				return false;
			}
			jdbcTemplate.batchUpdate("""
					insert into channel_verdict (baseline_id, run_id, channel_id, rank, excursions, persistent_z, deviation,
					                             max_abs_summary_z, sf6_mean_z, sf6_sd_z, c4f8_mean_z, c4f8_sd_z)
					values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", assessment.verdicts()
				.stream()
				.map((verdict) -> new Object[] { baseline.id(), runId.value(), channelIds.get(verdict.channel()),
						verdict.rank(), verdict.excursions().size(), verdict.persistentZ(), verdict.deviation(),
						verdict.maxAbsSummaryZ(), z(verdict, Phase.SF6, SummaryStat.MEAN), z(verdict, Phase.SF6, SummaryStat.SD),
						z(verdict, Phase.C4F8, SummaryStat.MEAN), z(verdict, Phase.C4F8, SummaryStat.SD) })
				.toList());
			List<Object[]> excursions = new ArrayList<>();
			for (ChannelVerdict verdict : assessment.verdicts()) {
				for (Excursion e : verdict.excursions()) {
					excursions.add(new Object[] { baseline.id(), runId.value(), channelIds.get(verdict.channel()),
							e.startSlot(), e.confirmSlot(), e.endSlot(), e.outSamples(), e.peakZ() });
				}
			}
			if (!excursions.isEmpty()) {
				jdbcTemplate.batchUpdate("""
						insert into excursion (baseline_id, run_id, channel_id, start_slot, confirm_slot, end_slot,
						                       out_samples, peak_z)
						values (?, ?, ?, ?, ?, ?, ?, ?)""", excursions);
			}
			return true;
		}));
	}

	/**
	 * Points the baseline's source at it, unless the current baseline was chosen from newer labels. One upsert,
	 * so two refreshes racing each other need no lock.
	 *
	 * @return whether the baseline is current afterwards
	 */
	public boolean makeCurrent(BaselineRef baseline, long labelsSeq) {
		return jdbc.sql("""
				insert into current_baseline (source, baseline_id, labels_seq)
				values (:source, :baseline, :labelsSeq)
				on conflict (source) do update
				set baseline_id = excluded.baseline_id, labels_seq = excluded.labels_seq
				where current_baseline.labels_seq <= excluded.labels_seq""")
			.param("source", baseline.source().name())
			.param("baseline", baseline.id())
			.param("labelsSeq", labelsSeq)
			.update() == 1;
	}

	public int flaggedRuns(BaselineRef baseline) {
		return jdbc.sql("select count(*) from run_assessment where baseline_id = :baseline and limit_flags + deviation_flags > 0")
			.param("baseline", baseline.id())
			.query(Integer.class)
			.single();
	}

	/**
	 * Deletes the source's baselines older than the newest {@code keep}, never the current one, and every row
	 * under them.
	 *
	 * @return baselines deleted
	 */
	public int prune(Source source, int keep) {
		return jdbc.sql("""
				delete from baseline b
				where b.source = :source
				  and b.id not in (select baseline_id from current_baseline where source = :source)
				  and b.id not in (select id from baseline where source = :source order by id desc limit :keep)""")
			.param("source", source.name())
			.param("keep", keep)
			.update();
	}

	private void copyBands(int baselineId, Baseline baseline, Map<ChannelName, Short> channelIds) {
		StringBuilder csv = new StringBuilder();
		for (ChannelBand band : baseline.bands().values()) {
			short channelId = channelIds.get(band.channel());
			for (int slot = 0; slot < band.slotCount(); slot++) {
				float mean = band.mean(slot);
				if (Float.isNaN(mean)) {
					continue;
				}
				csv.append(baselineId).append(',').append(channelId).append(',').append(slot).append(',').append(mean).append(',');
				if (band.hasBand(slot)) {
					csv.append(band.sd(slot));
				}
				csv.append('\n');
			}
		}
		Copy.in(dataSource, COPY_BANDS, csv, "the bands of baseline " + baselineId);
	}

	private static Double z(ChannelVerdict verdict, Phase phase, SummaryStat stat) {
		return verdict.summaryZ()
			.stream()
			.filter((score) -> score.phase() == phase && score.stat() == stat)
			.map(ChannelVerdict.SummaryZ::z)
			.findFirst()
			.orElse(null);
	}

	private static Integer storedId(Map<RunKey, RunId> runIds, RunKey key) {
		RunId id = runIds.get(key);
		if (id == null) {
			throw new IllegalArgumentException("good run " + key.value() + " is not stored");
		}
		return id.value();
	}

	private static float[] emptyProfile(RecipeGrid grid) {
		float[] profile = new float[grid.slotCount()];
		Arrays.fill(profile, Float.NaN);
		return profile;
	}

	private Map<ChannelName, Short> channelIds() {
		return channelNames().entrySet().stream().collect(Collectors.toMap(Map.Entry::getValue, Map.Entry::getKey));
	}

	private Map<Short, ChannelName> channelNames() {
		return jdbc.sql("select id, name from channel")
			.query((rs, row) -> Map.entry(rs.getShort("id"), ChannelName.of(rs.getString("name"))))
			.list()
			.stream()
			.collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));
	}

}
