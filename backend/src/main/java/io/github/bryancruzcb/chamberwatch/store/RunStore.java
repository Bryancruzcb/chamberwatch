package io.github.bryancruzcb.chamberwatch.store;

import java.sql.Date;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.SortedMap;
import java.util.TreeMap;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

import javax.sql.DataSource;

import io.github.bryancruzcb.chamberwatch.detect.Label;
import io.github.bryancruzcb.chamberwatch.recipe.AlignedRun;
import io.github.bryancruzcb.chamberwatch.recipe.Aligner;
import io.github.bryancruzcb.chamberwatch.recipe.AlignmentReport;
import io.github.bryancruzcb.chamberwatch.recipe.AlignmentResult;
import io.github.bryancruzcb.chamberwatch.recipe.AlignmentStatus;
import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;
import io.github.bryancruzcb.chamberwatch.recipe.ChannelSet;
import io.github.bryancruzcb.chamberwatch.recipe.RawRun;
import io.github.bryancruzcb.chamberwatch.recipe.RecipeGrid;
import io.github.bryancruzcb.chamberwatch.recipe.RunKey;
import io.github.bryancruzcb.chamberwatch.recipe.SlotAssignment;
import io.github.bryancruzcb.chamberwatch.recipe.Source;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Writes lots, runs, their samples and phase summaries, keeps the ingest ledger, and reads runs back for
 * scoring. A run row, all of its samples and its summaries commit in one transaction, so a stored run key
 * always means a whole run and storing it again writes nothing.
 */
@Repository
public class RunStore {

	private static final String COPY_SAMPLES = "copy sample (run_id, channel_id, sample_idx, t_s, value, slot) from stdin (format csv)";

	private final JdbcClient jdbc;

	private final JdbcTemplate jdbcTemplate;

	private final DataSource dataSource;

	private final TransactionTemplate transactions;

	private final Map<ChannelName, Short> channelIds = new ConcurrentHashMap<>();

	public RunStore(JdbcClient jdbc, JdbcTemplate jdbcTemplate, DataSource dataSource, TransactionTemplate transactions) {
		this.jdbc = jdbc;
		this.jdbcTemplate = jdbcTemplate;
		this.dataSource = dataSource;
		this.transactions = transactions;
	}

	/** Inserts the lot unless it exists, and returns the stored row either way. */
	public LotRef upsertLot(LotRecord lot) {
		jdbc.sql("""
				insert into lot (source, lot_no, run_date, conditioning_count, conditioning_surface)
				values (:source, :lotNo, :runDate, :count, :surface)
				on conflict (source, lot_no) do nothing""")
			.param("source", lot.source().name())
			.param("lotNo", lot.lotNo())
			.param("runDate", lot.runDate().map(Date::valueOf).orElse(null))
			.param("count", lot.conditioning().map(LotRecord.Conditioning::count).orElse(null))
			.param("surface", lot.conditioning().map((conditioning) -> conditioning.surface().name()).orElse(null))
			.update();
		return jdbc.sql("select id, source, lot_no from lot where source = :source and lot_no = :lotNo")
			.param("source", lot.source().name())
			.param("lotNo", lot.lotNo())
			.query((rs, row) -> new LotRef(rs.getShort("id"), Source.valueOf(rs.getString("source")), rs.getInt("lot_no")))
			.single();
	}

	public Map<LocalDate, LotRef> publicLotsByDay() {
		return jdbc.sql("select id, source, lot_no, run_date from lot where source = 'PUBLIC' and run_date is not null")
			.query((rs, row) -> Map.entry(rs.getDate("run_date").toLocalDate(),
					new LotRef(rs.getShort("id"), Source.PUBLIC, rs.getInt("lot_no"))))
			.list()
			.stream()
			.collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));
	}

	public boolean exists(RunKey key) {
		return jdbc.sql("select exists (select 1 from run where run_key = :key)")
			.param("key", key.value())
			.query(Boolean.class)
			.single();
	}

	/**
	 * Stores a run with every recorded sample and, when it aligned, its phase summaries, in one transaction.
	 *
	 * @return the new id, or empty when the run key was already stored, in which case nothing was written
	 */
	public Optional<RunId> insertIfAbsent(RawRun raw, AlignmentResult result, LotRef lot) {
		Map<ChannelName, Short> ids = channelIds(raw.channels());
		return Objects.requireNonNull(transactions.execute((status) -> {
			Optional<Integer> id = insertRunRow(raw, result, lot);
			if (id.isEmpty()) {
				return Optional.<RunId>empty();
			}
			switch (result) {
				case AlignmentResult.Aligned aligned -> {
					copySamples(id.get(), raw, ids, aligned.slots());
					insertSummaries(id.get(), aligned.run(), ids);
				}
				case AlignmentResult.Failed failed -> copySamples(id.get(), raw, ids, null);
			}
			return Optional.of(new RunId(id.get()));
		}));
	}

	/** Every stored run of the source, with its label and alignment, read in one statement. */
	public RunRoster roster(Source source) {
		record Row(RunRoster.Entry entry, long labelSeq) {
		}
		List<Row> rows = jdbc.sql("""
				select r.id, r.run_key, r.position_in_lot, r.label, r.label_seq, r.alignment_status
				from run r
				join lot l on l.id = r.lot_id
				where l.source = :source
				order by r.run_key""")
			.param("source", source.name())
			.query((rs, row) -> {
				String status = rs.getString("alignment_status");
				Optional<AlignmentStatus> alignment = status.equals("FAILED") ? Optional.empty()
						: Optional.of(AlignmentStatus.valueOf(status));
				return new Row(new RunRoster.Entry(new RunId(rs.getInt("id")),
						new RunKey(rs.getString("run_key"), source, rs.getInt("position_in_lot")),
						Label.valueOf(rs.getString("label")), alignment), rs.getLong("label_seq"));
			})
			.list();
		return new RunRoster(source, rows.stream().map(Row::entry).toList(),
				rows.stream().mapToLong(Row::labelSeq).max().orElse(0));
	}

	/**
	 * Rebuilds a stored run on the grid from its slotted samples and its alignment columns. Values and slot
	 * times come back bit for bit, since they were stored as the same float.
	 *
	 * @throws IllegalStateException when the run failed alignment, or another aligner version placed it
	 */
	public AlignedRun loadAligned(RunId id) {
		Header header = jdbc.sql("""
				select r.run_key, l.source, r.position_in_lot, r.aligner_version, r.sample_count, r.alignment_status,
				       r.alignment_note, r.etch_start_s, r.etch_end_s, r.cycle1_sf6, r.c4f8_phases, r.last_cycle,
				       r.onsets_detected, r.onsets_predicted, r.gap_start_s, r.gap_length_s, r.gap_inside_etch,
				       r.pre_etch_samples, r.post_etch_samples, r.steady_overflow, r.edge_overflow, r.slot_collisions,
				       r.irregular_cycles
				from run r
				join lot l on l.id = r.lot_id
				where r.id = :id""")
			.param("id", id.value())
			.query(RunStore::header)
			.single();
		RecipeGrid grid = RecipeGrid.STANDARD;
		Map<Short, ChannelName> names = channelNames();
		SortedMap<ChannelName, float[]> profiles = new TreeMap<>();
		float[] slotTimes = emptyProfile(grid);
		jdbcTemplate.query("select channel_id, slot, t_s, value from sample where run_id = ? and slot is not null",
				(RowCallbackHandler) (rs) -> {
					int slot = rs.getShort(2);
					slotTimes[slot] = rs.getFloat(3);
					profiles.computeIfAbsent(names.get(rs.getShort(1)), (name) -> emptyProfile(grid))[slot] = rs.getFloat(4);
				}, id.value());
		ChannelSet channels = ChannelSet.of(profiles.keySet());
		float[] values = new float[channels.size() * grid.slotCount()];
		for (int channel = 0; channel < channels.size(); channel++) {
			System.arraycopy(profiles.get(channels.name(channel)), 0, values, channel * grid.slotCount(), grid.slotCount());
		}
		return AlignedRun.adopt(header.key(), grid, channels, values, slotTimes, header.report());
	}

	/** Public runs by the measurement files' experiment key, {@code YYYY-MM-DD_NN}. */
	public Map<String, RunId> publicRunsByExperimentKey() {
		return jdbc.sql("select r.id, r.run_key from run r join lot l on l.id = r.lot_id where l.source = 'PUBLIC'")
			.query((rs, row) -> Map.entry(RunKey.ofPublicGroup(rs.getString("run_key")).experimentKey().orElseThrow(),
					new RunId(rs.getInt("id"))))
			.list()
			.stream()
			.collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));
	}

	public LedgerStatus ledger(String md5, int alignerVersion) {
		return jdbc.sql("select status from ingest_file where md5 = :md5 and aligner_version = :version")
			.param("md5", md5)
			.param("version", alignerVersion)
			.query(String.class)
			.optional()
			.map(LedgerStatus::valueOf)
			.orElse(LedgerStatus.ABSENT);
	}

	/** Leaves an existing row alone, so a file left STARTED by a crash stays STARTED until it completes. */
	public void markStarted(String md5, int alignerVersion, String fileName, long bytes) {
		jdbc.sql("""
				insert into ingest_file (md5, aligner_version, file_name, bytes, status)
				values (:md5, :version, :name, :bytes, 'STARTED')
				on conflict do nothing""")
			.param("md5", md5)
			.param("version", alignerVersion)
			.param("name", fileName)
			.param("bytes", bytes)
			.update();
	}

	public void markComplete(String md5, int alignerVersion) {
		jdbc.sql("""
				update ingest_file set status = 'COMPLETE', completed_at = now()
				where md5 = :md5 and aligner_version = :version""")
			.param("md5", md5)
			.param("version", alignerVersion)
			.update();
	}

	private Optional<Integer> insertRunRow(RawRun raw, AlignmentResult result, LotRef lot) {
		Map<String, Object> params = new HashMap<>();
		params.put("runKey", raw.key().value());
		params.put("lotId", lot.id());
		params.put("position", raw.key().positionInLot());
		params.put("alignerVersion", Aligner.VERSION);
		params.put("sampleCount", raw.sampleCount());
		switch (result) {
			case AlignmentResult.Aligned aligned -> putReport(params, aligned.run().report());
			case AlignmentResult.Failed failed -> putFailure(params, failed);
		}
		return jdbc.sql("""
				insert into run (run_key, lot_id, position_in_lot, aligner_version, sample_count, alignment_status,
				                 alignment_note, etch_start_s, etch_end_s, cycle1_sf6, c4f8_phases, last_cycle,
				                 onsets_detected, onsets_predicted, gap_start_s, gap_length_s, gap_inside_etch,
				                 pre_etch_samples, post_etch_samples, steady_overflow, edge_overflow, slot_collisions,
				                 irregular_cycles)
				values (:runKey, :lotId, :position, :alignerVersion, :sampleCount, :status, :note, :etchStart,
				        :etchEnd, :cycle1Sf6, :c4f8Phases, :lastCycle, :detected, :predicted, :gapStart, :gapLength,
				        :gapInside, :preEtch, :postEtch, :steadyOverflow, :edgeOverflow, :collisions,
				        cast(:irregular as smallint[]))
				on conflict (run_key) do nothing
				returning id""")
			.params(params)
			.query(Integer.class)
			.optional();
	}

	private static void putReport(Map<String, Object> params, AlignmentReport report) {
		params.put("status", report.status().name());
		params.put("note", report.note().orElse(null));
		params.put("etchStart", report.etchStartS());
		params.put("etchEnd", report.etchEndS());
		params.put("cycle1Sf6", report.cycle1Sf6());
		params.put("c4f8Phases", report.c4f8Phases());
		params.put("lastCycle", report.lastCycle());
		params.put("detected", report.onsetsDetected());
		params.put("predicted", report.onsetsPredicted());
		params.put("gapStart", report.largestGap().map(AlignmentReport.Gap::startS).orElse(null));
		params.put("gapLength", report.largestGap().map(AlignmentReport.Gap::lengthS).orElse(null));
		params.put("gapInside", report.largestGap().map(AlignmentReport.Gap::insideEtch).orElse(null));
		params.put("preEtch", report.preEtchSamples());
		params.put("postEtch", report.postEtchSamples());
		params.put("steadyOverflow", report.steadyOverflowSamples());
		params.put("edgeOverflow", report.edgeOverflowSamples());
		params.put("collisions", report.slotCollisions());
		params.put("irregular", report.irregularCycles()
			.stream()
			.map(String::valueOf)
			.collect(Collectors.joining(",", "{", "}")));
	}

	private static void putFailure(Map<String, Object> params, AlignmentResult.Failed failed) {
		params.put("status", "FAILED");
		params.put("note", failed.reason());
		for (String column : List.of("etchStart", "etchEnd", "cycle1Sf6", "c4f8Phases", "lastCycle", "detected",
				"predicted", "gapStart", "gapLength", "gapInside", "preEtch", "postEtch", "steadyOverflow",
				"edgeOverflow", "collisions")) {
			params.put(column, null);
		}
		params.put("irregular", "{}");
	}

	private record Header(RunKey key, AlignmentReport report) {
	}

	private static Header header(ResultSet rs, int row) throws SQLException {
		RunKey key = new RunKey(rs.getString("run_key"), Source.valueOf(rs.getString("source")),
				rs.getInt("position_in_lot"));
		String status = rs.getString("alignment_status");
		if (status.equals("FAILED")) {
			throw new IllegalStateException(key.value() + " failed alignment and has no slots");
		}
		if (rs.getInt("aligner_version") != Aligner.VERSION) {
			throw new IllegalStateException(key.value() + " was placed by aligner version " + rs.getInt("aligner_version"));
		}
		double gapStart = rs.getDouble("gap_start_s");
		Optional<AlignmentReport.Gap> gap = rs.wasNull() ? Optional.empty()
				: Optional.of(new AlignmentReport.Gap(gapStart, rs.getDouble("gap_length_s"), rs.getBoolean("gap_inside_etch")));
		List<Integer> irregular = new ArrayList<>();
		for (Object cycle : (Object[]) rs.getArray("irregular_cycles").getArray()) {
			irregular.add(((Number) cycle).intValue());
		}
		return new Header(key,
				new AlignmentReport(AlignmentStatus.valueOf(status), Optional.ofNullable(rs.getString("alignment_note")),
						rs.getInt("sample_count"), rs.getDouble("etch_start_s"), rs.getDouble("etch_end_s"),
						rs.getBoolean("cycle1_sf6"), rs.getInt("c4f8_phases"), rs.getInt("last_cycle"),
						rs.getInt("onsets_detected"), rs.getInt("onsets_predicted"), gap, rs.getInt("pre_etch_samples"),
						rs.getInt("post_etch_samples"), rs.getInt("steady_overflow"), rs.getInt("edge_overflow"),
						rs.getInt("slot_collisions"), irregular));
	}

	private static float[] emptyProfile(RecipeGrid grid) {
		float[] profile = new float[grid.slotCount()];
		Arrays.fill(profile, Float.NaN);
		return profile;
	}

	/** Channel ids are created outside the run's transaction, so a rolled-back run never leaves a stale id cached. */
	private Map<ChannelName, Short> channelIds(ChannelSet channels) {
		Map<ChannelName, Short> ids = new HashMap<>();
		for (ChannelName name : channels.names()) {
			ids.put(name, channelIds.computeIfAbsent(name, this::channelId));
		}
		return ids;
	}

	private short channelId(ChannelName name) {
		jdbc.sql("insert into channel (name) values (:name) on conflict (name) do nothing")
			.param("name", name.value())
			.update();
		return jdbc.sql("select id from channel where name = :name").param("name", name.value()).query(Short.class).single();
	}

	private Map<Short, ChannelName> channelNames() {
		return jdbc.sql("select id, name from channel")
			.query((rs, row) -> Map.entry(rs.getShort("id"), ChannelName.of(rs.getString("name"))))
			.list()
			.stream()
			.collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));
	}

	/** Streams every value of the run through COPY, in primary key order. {@code slots} is null for a failed run. */
	private void copySamples(int runId, RawRun raw, Map<ChannelName, Short> ids, SlotAssignment slots) {
		StringBuilder csv = new StringBuilder(raw.sampleCount() * raw.channels().size() * 32);
		for (int channel = 0; channel < raw.channels().size(); channel++) {
			short channelId = ids.get(raw.channels().name(channel));
			for (int sample = 0; sample < raw.sampleCount(); sample++) {
				float value = raw.value(channel, sample);
				if (!Float.isFinite(value)) {
					throw new IllegalStateException(raw.key().value() + ": value is not finite at sample " + sample);
				}
				csv.append(runId).append(',').append(channelId).append(',').append(sample).append(',');
				csv.append((float) raw.time(sample)).append(',').append(value).append(',');
				int slot = (slots == null) ? -1 : slots.slotOf(sample);
				if (slot >= 0) {
					csv.append(slot);
				}
				csv.append('\n');
			}
		}
		Copy.in(dataSource, COPY_SAMPLES, csv, "the samples of " + raw.key().value());
	}

	private void insertSummaries(int runId, AlignedRun run, Map<ChannelName, Short> ids) {
		List<Object[]> rows = run.summaries()
			.stream()
			.map((summary) -> new Object[] { runId, ids.get(summary.channel()), summary.phase().name(), summary.n(),
					summary.mean(), summary.sd(), summary.min(), summary.max() })
			.toList();
		jdbcTemplate.batchUpdate("""
				insert into run_phase_summary (run_id, channel_id, phase, n, mean, sd, min, max)
				values (?, ?, ?, ?, ?, ?, ?, ?)""", rows);
	}

	/** Where a source file stands in the ingest. */
	public enum LedgerStatus {

		ABSENT, STARTED, COMPLETE

	}

}
