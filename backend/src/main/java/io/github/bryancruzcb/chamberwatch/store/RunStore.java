package io.github.bryancruzcb.chamberwatch.store;

import java.io.IOException;
import java.io.StringReader;
import java.sql.Connection;
import java.sql.Date;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

import javax.sql.DataSource;

import io.github.bryancruzcb.chamberwatch.recipe.AlignedRun;
import io.github.bryancruzcb.chamberwatch.recipe.Aligner;
import io.github.bryancruzcb.chamberwatch.recipe.AlignmentReport;
import io.github.bryancruzcb.chamberwatch.recipe.AlignmentResult;
import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;
import io.github.bryancruzcb.chamberwatch.recipe.ChannelSet;
import io.github.bryancruzcb.chamberwatch.recipe.RawRun;
import io.github.bryancruzcb.chamberwatch.recipe.RunKey;
import io.github.bryancruzcb.chamberwatch.recipe.SlotAssignment;
import io.github.bryancruzcb.chamberwatch.recipe.Source;
import org.postgresql.PGConnection;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DataSourceUtils;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Writes lots, runs, their samples and phase summaries, and keeps the ingest ledger. A run row, all of
 * its samples and its summaries commit in one transaction, so a stored run key always means a whole
 * run and storing it again writes nothing.
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
		Connection connection = DataSourceUtils.getConnection(dataSource);
		try {
			connection.unwrap(PGConnection.class).getCopyAPI().copyIn(COPY_SAMPLES, new StringReader(csv.toString()));
		}
		catch (SQLException | IOException ex) {
			throw new IllegalStateException("COPY of samples failed for " + raw.key().value(), ex);
		}
		finally {
			DataSourceUtils.releaseConnection(connection, dataSource);
		}
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
