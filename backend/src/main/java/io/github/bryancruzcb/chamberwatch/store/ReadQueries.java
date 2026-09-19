package io.github.bryancruzcb.chamberwatch.store;

import java.sql.Array;
import java.sql.Date;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalInt;

import io.github.bryancruzcb.chamberwatch.detect.DetectorConfig;
import io.github.bryancruzcb.chamberwatch.detect.DriftProjection;
import io.github.bryancruzcb.chamberwatch.detect.DriftReference;
import io.github.bryancruzcb.chamberwatch.detect.HealthModel;
import io.github.bryancruzcb.chamberwatch.detect.Label;
import io.github.bryancruzcb.chamberwatch.detect.LotFit;
import io.github.bryancruzcb.chamberwatch.detect.SummaryBand;
import io.github.bryancruzcb.chamberwatch.recipe.Phase;
import io.github.bryancruzcb.chamberwatch.recipe.RecipeGrid;
import io.github.bryancruzcb.chamberwatch.recipe.RecipePosition;
import io.github.bryancruzcb.chamberwatch.recipe.Source;

import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/**
 * What the screens read: the runs table, the run page, the wafer page, the lot page and the drift report.
 * Every answer uses the current baseline of the source, and each takes a handful of statements. Times and
 * values stored as {@code real} come back with the digits that float held, not the noise of widening it.
 */
@Repository
public class ReadQueries {

	private static final RecipeGrid GRID = RecipeGrid.STANDARD;

	private static final String LOTS = """
			select l.id, l.source, l.lot_no, l.run_date, l.conditioning_count, l.conditioning_surface,
			       count(r.id) as runs,
			       count(a.run_id) filter (where a.limit_flags + a.deviation_flags + a.stuck_flags > 0) as flagged_runs
			from lot l
			left join run r on r.lot_id = l.id
			left join current_baseline cb on cb.source = l.source
			left join run_assessment a on a.baseline_id = cb.baseline_id and a.run_id = r.id
			where cast(:lot as integer) is null or l.id = cast(:lot as integer)
			group by l.id
			order by l.source, l.lot_no""";

	private final JdbcClient jdbc;

	private final DetectorConfig config;

	public ReadQueries(JdbcClient jdbc, DetectorConfig config) {
		this.jdbc = jdbc;
		this.config = config;
	}

	/** @param flaggedRuns runs flagged under the current baseline of the lot's source */
	public record Lot(int id, Source source, int lotNo, LocalDate runDate, Integer conditioningCount,
			String conditioningSurface, int runs, int flaggedRuns) {
	}

	/** @param k the limit rule's band half-width, and {@code n} the samples it needs in a row */
	public record BaselineSummary(int id, int goodRuns, double k, int n, double runZ) {
	}

	/** One row of the runs table. The flag fields are null for a run not scored under the current baseline. */
	public record RunRow(int id, String key, int lotId, int lotNo, int positionInLot, Label label, String alignment,
			boolean good, boolean scored, Integer limitFlags, Integer deviationFlags, Integer stuckFlags,
			Double persistentZ, String firstChannel, Double firstTimeS) {
	}

	/** @param baseline null until the source has been refreshed once */
	public record RunsPage(BaselineSummary baseline, List<RunRow> runs) {
	}

	public record Alignment(String status, String note, Double etchStartS, Double etchEndS, Boolean cycle1Sf6,
			Integer c4f8Phases, Integer lastCycle, Integer onsetsDetected, Integer onsetsPredicted, Double gapStartS,
			Double gapLengthS, Boolean gapInsideEtch, List<Integer> irregularCycles) {
	}

	public record Assessment(int limitFlags, int deviationFlags, int stuckFlags, double persistentZ, String firstChannel,
			Double firstTimeS) {
	}

	/** A confirmed excursion, with the recipe position of its first sample and the record times of its slots. */
	public record Excursion(String channel, int startSlot, int confirmSlot, int endSlot, int cycle, Phase phase,
			int offset, Double startTimeS, Double confirmTimeS, Double endTimeS, int outSamples, double peakZ) {
	}

	/**
	 * One phase of one channel: the run's mean and spread over its scored cycles, the good runs' band for
	 * each, and the z-score between them.
	 */
	public record PhaseEvidence(Phase phase, Double mean, Double sd, Double goodMean, Double goodMeanSd, Double meanZ,
			Double goodSd, Double goodSdSd, Double sdZ) {
	}

	/** A hold that passed the stuck rule, with the recipe position of its first sample and the record times of its slots. */
	public record HoldView(String channel, int startSlot, int confirmSlot, int endSlot, int cycle, Phase phase, int offset,
			Double startTimeS, Double confirmTimeS, Double endTimeS, int samples, double value) {
	}

	/**
	 * @param longestHold the longest run of one value in the channel, in samples, whether or not it passed the rule
	 * @param holds       the holds that passed the stuck rule, in slot order
	 */
	public record Channel(String channel, int rank, double persistentZ, boolean deviation, double maxAbsSummaryZ,
			int longestHold, List<PhaseEvidence> phases, List<Excursion> excursions, List<HoldView> holds) {
	}

	/**
	 * The fault the simulator injected into a synthetic run, in the run's own seconds. {@code durationS} is
	 * null for a fault that lasted to the end of the etch, and for a reflected power rise it is the ramp.
	 */
	public record InjectedFault(String kind, String channel, double startS, double endS, Double durationS,
			double magnitude) {
	}

	/**
	 * The run page. {@code baseline}, {@code assessment} and the channels are empty until the run is scored
	 * under the current baseline; channels come in rank order. {@code injectedFault} is null for public runs
	 * and clean synthetic ones.
	 */
	public record RunDetail(int id, String key, Source source, int lotId, int lotNo, LocalDate runDate,
			int positionInLot, Label label, int sampleCount, Alignment alignment, BaselineSummary baseline, boolean good,
			Assessment assessment, List<Channel> channels, InjectedFault injectedFault) {
	}

	/**
	 * One bucket of a trace: the first and last sample time, the lowest and highest reading, and the recipe
	 * position and good-run band of its first slotted sample.
	 */
	public record TracePoint(double startS, double endS, int samples, double min, double max, Integer slot,
			Integer cycle, Phase phase, Integer offset, Double bandMean, Double bandSd) {
	}

	/** @param k the band half-width to draw, from the current baseline */
	public record Trace(String channel, String role, Double k, Integer fromCycle, Integer toCycle, int samples,
			List<TracePoint> points, List<Excursion> excursions) {
	}

	public record MeasurementPoint(int pointNo, String locId, double xUm, double yUm, double preoxUm, double postoxUm,
			boolean postoxMeasured, double stepheightUm, double depthUm) {
	}

	public record Measurements(MeasurementSet set, int points, Double meanDepthUm, Double sdDepthUm,
			List<MeasurementPoint> values) {
	}

	/**
	 * One wafer on the lot page: its phase mean, and the drift detector's verdict once that wafer was in.
	 *
	 * @param z      the phase mean against the good runs' band, in their standard deviations
	 * @param runs   wafers in the fit so far
	 * @param slope  the fit of the wafers so far, null at the first wafer like {@code intercept} and {@code fitted}
	 * @param tStat  null with fewer than 3 wafers, and for a line without scatter
	 * @param fitted the fitted value at this wafer
	 */
	public record DriftPoint(int runId, String key, int position, double value, double z, int runs, Double slope,
			Double intercept, Double tStat, Double fitted, DriftProjection.State state, Integer firstOutPosition,
			Integer runsRemaining) {
	}

	/**
	 * One channel on the lot page.
	 *
	 * @param low   the drift band's lower edge: the good runs' mean less the drift rule's k standard deviations
	 * @param state the verdict as of the lot's last wafer
	 */
	public record DriftChannel(String channel, double bandMean, double bandSd, double low, double high,
			DriftProjection.State state, List<DriftPoint> points) {
	}

	/**
	 * @param baseline        null until the lot's source has been refreshed once
	 * @param reference       what centers each channel's band: the good runs, or this lot's own first wafers
	 * @param referenceWafers how many of the lot's first wafers a {@code LOT} reference averages, at most; a channel
	 *                        with none of them summarized keeps the good runs' mean
	 */
	public record LotDrift(Lot lot, Phase phase, BaselineSummary baseline, DetectorConfig.DriftRule rule,
			DriftReference reference, int referenceWafers, List<DriftChannel> channels) {
	}

	/**
	 * Measured depth at one position in lot, for one measurement set.
	 *
	 * @param wafers          wafers at the position measured in the set
	 * @param meanDepthLossUm how much shallower than the mean of their lot's first wafers they etched, on average;
	 *                        null when no lot has its first wafers measured in the set
	 */
	public record PositionDepth(MeasurementSet set, int wafers, double meanDepthUm, Double meanDepthLossUm) {
	}

	/**
	 * @param scoredRuns     runs with a drift score under the current baseline
	 * @param meanDriftScore their mean drift score, where a run's drift score is the root mean square of its
	 *                       channels' SF6 phase mean z-scores
	 */
	public record PositionDrift(int position, int runs, int scoredRuns, Double meanDriftScore, int flaggedRuns,
			List<PositionDepth> depth) {
	}

	/**
	 * By position in lot, how far runs sit from the good runs, next to how deep they etched, with the measurement
	 * sets kept apart.
	 *
	 * @param referenceWafers depth loss counts from the mean depth of each lot's first this many wafers
	 */
	public record DriftVsDepth(Source source, BaselineSummary baseline, int referenceWafers,
			List<PositionDrift> positions) {
	}

	public List<Lot> lots() {
		return lots(null);
	}

	public Optional<Lot> lot(int lotId) {
		return lots(lotId).stream().findFirst();
	}

	public Optional<BaselineSummary> currentBaseline(Source source) {
		return jdbc.sql("""
				select b.id, b.limit_k, b.limit_n, b.run_z,
				       (select count(*) from baseline_good_run g where g.baseline_id = b.id) as good_runs
				from current_baseline cb
				join baseline b on b.id = cb.baseline_id
				where cb.source = :source""")
			.param("source", source.name())
			.query((rs, row) -> new BaselineSummary(rs.getInt("id"), rs.getInt("good_runs"), rs.getDouble("limit_k"),
					rs.getInt("limit_n"), rs.getDouble("run_z")))
			.optional();
	}

	/**
	 * @param lotId   only this lot, or every lot of the source when null
	 * @param flagged only flagged runs, only unflagged ones, or both when null
	 */
	public RunsPage runs(Source source, Integer lotId, Boolean flagged) {
		List<RunRow> rows = jdbc.sql("""
				select r.id, r.run_key, r.lot_id, l.lot_no, r.position_in_lot, r.label, r.alignment_status,
				       g.run_id is not null as good, a.run_id is not null as scored, a.limit_flags, a.deviation_flags,
				       a.stuck_flags, a.max_persistent_z, c.name as first_channel, a.first_time_s
				from run r
				join lot l on l.id = r.lot_id
				left join current_baseline cb on cb.source = l.source
				left join run_assessment a on a.baseline_id = cb.baseline_id and a.run_id = r.id
				left join baseline_good_run g on g.baseline_id = cb.baseline_id and g.run_id = r.id
				left join channel c on c.id = a.first_channel_id
				where l.source = :source
				  and (cast(:lotId as integer) is null or r.lot_id = cast(:lotId as integer))
				  and (cast(:flagged as boolean) is null
				       or coalesce(a.limit_flags + a.deviation_flags + a.stuck_flags > 0, false) = cast(:flagged as boolean))
				order by l.lot_no, r.position_in_lot""")
			.param("source", source.name())
			.param("lotId", lotId, Types.INTEGER)
			.param("flagged", flagged, Types.BOOLEAN)
			.query((rs, row) -> new RunRow(rs.getInt("id"), rs.getString("run_key"), rs.getInt("lot_id"),
					rs.getInt("lot_no"), rs.getInt("position_in_lot"), Label.valueOf(rs.getString("label")),
					rs.getString("alignment_status"), rs.getBoolean("good"), rs.getBoolean("scored"),
					integer(rs, "limit_flags"), integer(rs, "deviation_flags"), integer(rs, "stuck_flags"),
					decimal(rs, "max_persistent_z"), rs.getString("first_channel"), real(rs, "first_time_s")))
			.list();
		return new RunsPage(currentBaseline(source).orElse(null), rows);
	}

	public Optional<RunDetail> run(int runId) {
		record Header(String key, Source source, int lotId, int lotNo, LocalDate runDate, int position, Label label,
				int sampleCount, Alignment alignment) {
		}
		Optional<Header> found = jdbc.sql("""
				select r.run_key, l.source, l.id as lot_id, l.lot_no, l.run_date, r.position_in_lot, r.label,
				       r.sample_count, r.alignment_status, r.alignment_note, r.etch_start_s, r.etch_end_s, r.cycle1_sf6,
				       r.c4f8_phases, r.last_cycle, r.onsets_detected, r.onsets_predicted, r.gap_start_s,
				       r.gap_length_s, r.gap_inside_etch, r.irregular_cycles
				from run r
				join lot l on l.id = r.lot_id
				where r.id = :run""")
			.param("run", runId)
			.query((rs, row) -> new Header(rs.getString("run_key"), Source.valueOf(rs.getString("source")),
					rs.getInt("lot_id"), rs.getInt("lot_no"), date(rs, "run_date"), rs.getInt("position_in_lot"),
					Label.valueOf(rs.getString("label")), rs.getInt("sample_count"),
					new Alignment(rs.getString("alignment_status"), rs.getString("alignment_note"),
							real(rs, "etch_start_s"), real(rs, "etch_end_s"), bool(rs, "cycle1_sf6"),
							integer(rs, "c4f8_phases"), integer(rs, "last_cycle"), integer(rs, "onsets_detected"),
							integer(rs, "onsets_predicted"), real(rs, "gap_start_s"), real(rs, "gap_length_s"),
							bool(rs, "gap_inside_etch"), integers(rs.getArray("irregular_cycles")))))
			.optional();
		if (found.isEmpty()) {
			return Optional.empty();
		}
		Header header = found.get();
		Optional<BaselineSummary> baseline = currentBaseline(header.source());
		boolean good = false;
		Optional<Assessment> assessment = Optional.empty();
		List<Channel> channels = List.of();
		if (baseline.isPresent()) {
			int baselineId = baseline.get().id();
			good = jdbc.sql("select exists (select 1 from baseline_good_run where baseline_id = :baseline and run_id = :run)")
				.param("baseline", baselineId)
				.param("run", runId)
				.query(Boolean.class)
				.single();
			assessment = jdbc.sql("""
					select a.limit_flags, a.deviation_flags, a.stuck_flags, a.max_persistent_z, c.name as first_channel,
					       a.first_time_s
					from run_assessment a
					left join channel c on c.id = a.first_channel_id
					where a.baseline_id = :baseline and a.run_id = :run""")
				.param("baseline", baselineId)
				.param("run", runId)
				.query((rs, row) -> new Assessment(rs.getInt("limit_flags"), rs.getInt("deviation_flags"),
						rs.getInt("stuck_flags"), rs.getDouble("max_persistent_z"), rs.getString("first_channel"),
						real(rs, "first_time_s")))
				.optional();
			if (assessment.isPresent()) {
				channels = channels(baselineId, runId);
			}
		}
		InjectedFault injected = jdbc.sql("""
				select f.kind, c.name as channel, f.start_s, f.end_s, f.duration_s, f.magnitude
				from injected_fault f
				join channel c on c.id = f.channel_id
				where f.run_id = :run""")
			.param("run", runId)
			.query((rs, row) -> new InjectedFault(rs.getString("kind"), rs.getString("channel"), rs.getFloat("start_s"),
					rs.getFloat("end_s"), real(rs, "duration_s"), rs.getDouble("magnitude")))
			.optional()
			.orElse(null);
		return Optional.of(new RunDetail(runId, header.key(), header.source(), header.lotId(), header.lotNo(),
				header.runDate(), header.position(), header.label(), header.sampleCount(), header.alignment(),
				baseline.orElse(null), good, assessment.orElse(null), channels, injected));
	}

	/**
	 * A channel of a run, reduced to at most {@code maxPoints} buckets of consecutive samples. Keeping each
	 * bucket's lowest and highest reading means a one-sample spike survives. Without a cycle range the whole
	 * record comes back, before and after the etch included.
	 *
	 * @return empty when the run does not exist or does not record the channel
	 */
	public Optional<Trace> trace(int runId, String channel, Integer fromCycle, Integer toCycle, int maxPoints) {
		Optional<Source> source = jdbc.sql("select l.source from run r join lot l on l.id = r.lot_id where r.id = :run")
			.param("run", runId)
			.query((rs, row) -> Source.valueOf(rs.getString("source")))
			.optional();
		Optional<Integer> channelId = jdbc.sql("select id from channel where name = :name")
			.param("name", channel)
			.query(Integer.class)
			.optional();
		if (source.isEmpty() || channelId.isEmpty() || !jdbc
			.sql("select exists (select 1 from sample where run_id = :run and channel_id = :channel)")
			.param("run", runId)
			.param("channel", channelId.get())
			.query(Boolean.class)
			.single()) {
			return Optional.empty();
		}
		Optional<BaselineSummary> baseline = currentBaseline(source.get());
		Integer baselineId = baseline.map(BaselineSummary::id).orElse(null);
		List<TracePoint> points = jdbc.sql("""
				with selected as (
				    select s.sample_idx, s.t_s, s.value, s.slot
				    from sample s
				    left join recipe_slot rs on rs.slot = s.slot
				    where s.run_id = :run and s.channel_id = :channel
				      and (cast(:fromCycle as integer) is null or rs.cycle >= cast(:fromCycle as integer))
				      and (cast(:toCycle as integer) is null or rs.cycle <= cast(:toCycle as integer))
				),
				buckets as (
				    select ntile(:maxPoints) over (order by sample_idx) as bucket, t_s, value, slot
				    from selected
				),
				reduced as (
				    select bucket, min(t_s) as start_s, max(t_s) as end_s, count(*) as samples,
				           min(value) as min_value, max(value) as max_value, min(slot) as first_slot
				    from buckets
				    group by bucket
				)
				select d.start_s, d.end_s, d.samples, d.min_value, d.max_value, d.first_slot, rs.cycle, rs.phase,
				       rs.phase_offset, b.mean as band_mean, b.sd as band_sd
				from reduced d
				left join recipe_slot rs on rs.slot = d.first_slot
				left join band b on b.baseline_id = cast(:baseline as integer) and b.channel_id = :channel
				                and b.slot = d.first_slot
				order by d.bucket""")
			.param("run", runId)
			.param("channel", channelId.get())
			.param("fromCycle", fromCycle, Types.INTEGER)
			.param("toCycle", toCycle, Types.INTEGER)
			.param("maxPoints", maxPoints)
			.param("baseline", baselineId, Types.INTEGER)
			.query((rs, row) -> new TracePoint(real(rs, "start_s"), real(rs, "end_s"), rs.getInt("samples"),
					real(rs, "min_value"), real(rs, "max_value"), integer(rs, "first_slot"), integer(rs, "cycle"),
					phase(rs, "phase"), integer(rs, "phase_offset"), real(rs, "band_mean"), real(rs, "band_sd")))
			.list();
		String role = null;
		List<Excursion> excursions = List.of();
		if (baselineId != null) {
			role = jdbc.sql("select role from baseline_channel where baseline_id = :baseline and channel_id = :channel")
				.param("baseline", baselineId)
				.param("channel", channelId.get())
				.query(String.class)
				.optional()
				.orElse(null);
			excursions = excursions(baselineId, runId, channel, slotTimes(runId));
		}
		int samples = points.stream().mapToInt(TracePoint::samples).sum();
		return Optional.of(new Trace(channel, role, baseline.map(BaselineSummary::k).orElse(null), fromCycle, toCycle,
				samples, points, excursions));
	}

	/** @return empty when no run has that id; a run without measurements of that set has no values */
	public Optional<Measurements> measurements(int runId, MeasurementSet set) {
		boolean exists = jdbc.sql("select exists (select 1 from run where id = :run)")
			.param("run", runId)
			.query(Boolean.class)
			.single();
		if (!exists) {
			return Optional.empty();
		}
		List<MeasurementPoint> values = jdbc.sql("""
				select point_no, loc_id, x_um, y_um, preox_um, postox_um, postox_measured, stepheight_um, depth_um
				from measurement
				where run_id = :run and measurement_set = :set
				order by point_no""")
			.param("run", runId)
			.param("set", set.name())
			.query((rs, row) -> new MeasurementPoint(rs.getInt("point_no"), rs.getString("loc_id"), real(rs, "x_um"),
					real(rs, "y_um"), real(rs, "preox_um"), real(rs, "postox_um"), rs.getBoolean("postox_measured"),
					real(rs, "stepheight_um"), real(rs, "depth_um")))
			.list();
		double[] depths = values.stream().mapToDouble(MeasurementPoint::depthUm).toArray();
		Double mean = (depths.length == 0) ? null : Arrays.stream(depths).average().orElseThrow();
		Double sd = null;
		if (depths.length > 1) {
			double squares = Arrays.stream(depths).map((depth) -> (depth - mean) * (depth - mean)).sum();
			sd = Math.sqrt(squares / (depths.length - 1));
		}
		return Optional.of(new Measurements(set, values.size(), mean, sd, values));
	}

	/**
	 * The lot page. Each channel with a band for the phase mean comes with the lot's wafers in position order, and
	 * at each wafer the least-squares fit of the wafers so far, which PostgreSQL's regression aggregates compute
	 * over a growing window, judged by {@link HealthModel#project}. Channels out of the band or projected to leave
	 * it come first, then the ones whose latest fitted value sits furthest from the good runs' mean.
	 *
	 * @return empty when no lot has that id; no channels until the lot's source has a baseline
	 */
	/**
	 * @param reference {@code LOT} centers each channel's band on the mean of the lot's first wafers, as many as
	 *                  the good-run policy takes per lot, keeping the good runs' spread; {@code GLOBAL} keeps the
	 *                  good runs' mean
	 */
	public Optional<LotDrift> lotDrift(int lotId, Phase phase, DriftReference reference) {
		Optional<Lot> lot = lot(lotId);
		if (lot.isEmpty()) {
			return Optional.empty();
		}
		DetectorConfig.DriftRule rule = config.drift();
		int referenceWafers = config.goodRunsPerLot();
		Optional<BaselineSummary> baseline = currentBaseline(lot.get().source());
		if (baseline.isEmpty()) {
			return Optional.of(new LotDrift(lot.get(), phase, null, rule, reference, referenceWafers, List.of()));
		}
		record Row(String channel, SummaryBand band, Double lotStart, int runId, String key, int position, double value,
				long runs, double positionMean, double valueMean, double sxx, double sxy, double syy) {
		}
		Map<String, List<Row>> rowsByChannel = new LinkedHashMap<>();
		jdbc.sql("""
				select c.name, b.mean as band_mean, b.sd as band_sd, r.id as run_id, r.run_key, r.position_in_lot, s.mean,
				       avg(s.mean) filter (where r.position_in_lot <= :referenceWafers)
				           over (partition by s.channel_id) as lot_start,
				       regr_count(s.mean, r.position_in_lot) over wafers_so_far as runs,
				       regr_avgx(s.mean, r.position_in_lot) over wafers_so_far as position_mean,
				       regr_avgy(s.mean, r.position_in_lot) over wafers_so_far as value_mean,
				       regr_sxx(s.mean, r.position_in_lot) over wafers_so_far as sxx,
				       regr_sxy(s.mean, r.position_in_lot) over wafers_so_far as sxy,
				       regr_syy(s.mean, r.position_in_lot) over wafers_so_far as syy
				from run r
				join run_phase_summary s on s.run_id = r.id and s.phase = :phase
				join summary_band b on b.baseline_id = :baseline and b.channel_id = s.channel_id and b.phase = s.phase
				                   and b.stat = 'MEAN'
				join channel c on c.id = s.channel_id
				where r.lot_id = :lot
				window wafers_so_far as (partition by s.channel_id order by r.position_in_lot
				                         rows between unbounded preceding and current row)
				order by c.name, r.position_in_lot""")
			.param("phase", phase.name())
			.param("baseline", baseline.get().id())
			.param("lot", lotId)
			.param("referenceWafers", referenceWafers)
			.query((RowCallbackHandler) (rs) -> rowsByChannel.computeIfAbsent(rs.getString("name"), (name) -> new ArrayList<>())
				.add(new Row(rs.getString("name"), new SummaryBand(rs.getDouble("band_mean"), rs.getDouble("band_sd")),
						decimal(rs, "lot_start"), rs.getInt("run_id"), rs.getString("run_key"), rs.getInt("position_in_lot"),
						rs.getDouble("mean"),
						rs.getLong("runs"), rs.getDouble("position_mean"), rs.getDouble("value_mean"), rs.getDouble("sxx"),
						rs.getDouble("sxy"), rs.getDouble("syy"))));
		List<DriftChannel> channels = new ArrayList<>();
		for (List<Row> rows : rowsByChannel.values()) {
			// the lot's own start centers the band only where the lot has first wafers to average
			SummaryBand band = (reference == DriftReference.LOT && rows.get(0).lotStart() != null)
					? new SummaryBand(rows.get(0).lotStart(), rows.get(0).band().sd()) : rows.get(0).band();
			List<DriftPoint> points = new ArrayList<>();
			for (Row row : rows) {
				if (row.runs() < 2) {
					// one wafer makes no line, and every drift rule wants at least three
					points.add(new DriftPoint(row.runId(), row.key(), row.position(), row.value(), band.z(row.value()), 1,
							null, null, null, null, DriftProjection.State.INSUFFICIENT_RUNS, null, null));
					continue;
				}
				LotFit fit = LotFit.fromSums(row.position(), row.runs(), row.positionMean(), row.valueMean(), row.sxx(),
						row.sxy(), row.syy());
				DriftProjection projection = HealthModel.project(fit, band, rule);
				points.add(new DriftPoint(row.runId(), row.key(), row.position(), row.value(), band.z(row.value()),
						fit.runs(), fit.slope(), fit.intercept(), finite(fit.tStat()), fit.valueAt(row.position()),
						projection.state(), boxed(projection.firstOutPosition()), boxed(projection.runsRemaining())));
			}
			channels.add(new DriftChannel(rows.get(0).channel(), band.mean(), band.sd(), band.low(rule.k()),
					band.high(rule.k()), points.get(points.size() - 1).state(), points));
		}
		channels.sort(Comparator.comparingInt((DriftChannel channel) -> urgency(channel.state()))
			.thenComparing(Comparator.comparingDouble(ReadQueries::distanceFromMean).reversed())
			.thenComparing(DriftChannel::channel));
		return Optional.of(new LotDrift(lot.get(), phase, baseline.get(), rule, reference, referenceWafers, channels));
	}

	/** The drift report, over every lot of the source. */
	public DriftVsDepth driftVsDepth(Source source) {
		Optional<BaselineSummary> baseline = currentBaseline(source);
		int referenceWafers = config.goodRunsPerLot();
		Map<Integer, List<PositionDepth>> depth = new HashMap<>();
		jdbc.sql("""
				with source_run as (
				    select r.id, r.lot_id, r.position_in_lot
				    from run r
				    join lot l on l.id = r.lot_id
				    where l.source = :source
				),
				wafer as (
				    select m.run_id, m.measurement_set, avg(m.depth_um) as depth
				    from measurement m
				    join source_run sr on sr.id = m.run_id
				    group by m.run_id, m.measurement_set
				),
				reference as (
				    select sr.lot_id, w.measurement_set, avg(w.depth) as depth
				    from wafer w
				    join source_run sr on sr.id = w.run_id
				    where sr.position_in_lot <= :referenceWafers
				    group by sr.lot_id, w.measurement_set
				)
				select sr.position_in_lot, w.measurement_set, count(*) as wafers, avg(w.depth) as mean_depth,
				       avg(ref.depth - w.depth) as mean_loss
				from wafer w
				join source_run sr on sr.id = w.run_id
				left join reference ref on ref.lot_id = sr.lot_id and ref.measurement_set = w.measurement_set
				group by sr.position_in_lot, w.measurement_set
				order by sr.position_in_lot, w.measurement_set""")
			.param("source", source.name())
			.param("referenceWafers", referenceWafers)
			.query((RowCallbackHandler) (rs) -> depth.computeIfAbsent(rs.getInt("position_in_lot"), (position) -> new ArrayList<>())
				.add(new PositionDepth(MeasurementSet.valueOf(rs.getString("measurement_set")), rs.getInt("wafers"),
						rs.getDouble("mean_depth"), decimal(rs, "mean_loss"))));
		List<PositionDrift> positions = jdbc.sql("""
				with drift as (
				    select v.run_id, sqrt(avg(v.sf6_mean_z * v.sf6_mean_z)) as score
				    from channel_verdict v
				    where v.baseline_id = :baseline and v.sf6_mean_z is not null
				    group by v.run_id
				)
				select r.position_in_lot, count(*) as runs, count(d.score) as scored_runs, avg(d.score) as mean_drift_score,
				       count(a.run_id) filter (where a.limit_flags + a.deviation_flags + a.stuck_flags > 0) as flagged_runs
				from run r
				join lot l on l.id = r.lot_id
				left join run_assessment a on a.baseline_id = :baseline and a.run_id = r.id
				left join drift d on d.run_id = r.id
				where l.source = :source
				group by r.position_in_lot
				order by r.position_in_lot""")
			.param("baseline", baseline.map(BaselineSummary::id).orElse(null), Types.INTEGER)
			.param("source", source.name())
			.query((rs, row) -> new PositionDrift(rs.getInt("position_in_lot"), rs.getInt("runs"),
					rs.getInt("scored_runs"), decimal(rs, "mean_drift_score"), rs.getInt("flagged_runs"),
					depth.getOrDefault(rs.getInt("position_in_lot"), List.of())))
			.list();
		return new DriftVsDepth(source, baseline.orElse(null), referenceWafers, positions);
	}

	/** @param lotId one lot, or every lot when null */
	private List<Lot> lots(Integer lotId) {
		return jdbc.sql(LOTS)
			.param("lot", lotId, Types.INTEGER)
			.query((rs, row) -> new Lot(rs.getInt("id"), Source.valueOf(rs.getString("source")), rs.getInt("lot_no"),
					date(rs, "run_date"), integer(rs, "conditioning_count"), rs.getString("conditioning_surface"),
					rs.getInt("runs"), rs.getInt("flagged_runs")))
			.list();
	}

	private List<Channel> channels(int baselineId, int runId) {
		double[] slotTimes = slotTimes(runId);
		Map<String, List<Excursion>> excursions = new HashMap<>();
		excursions(baselineId, runId, null, slotTimes)
			.forEach((excursion) -> excursions.computeIfAbsent(excursion.channel(), (name) -> new ArrayList<>()).add(excursion));
		Map<String, List<HoldView>> holds = new HashMap<>();
		holds(baselineId, runId, slotTimes)
			.forEach((hold) -> holds.computeIfAbsent(hold.channel(), (name) -> new ArrayList<>()).add(hold));
		Map<String, Map<Phase, double[]>> summaries = new HashMap<>();
		jdbc.sql("""
				select c.name, s.phase, s.mean, s.sd
				from run_phase_summary s
				join channel c on c.id = s.channel_id
				where s.run_id = :run""")
			.param("run", runId)
			.query((RowCallbackHandler) (rs) -> summaries.computeIfAbsent(rs.getString("name"), (name) -> new EnumMap<>(Phase.class))
				.put(Phase.valueOf(rs.getString("phase")), new double[] { rs.getDouble("mean"), rs.getDouble("sd") }));
		Map<String, Map<String, double[]>> bands = new HashMap<>();
		jdbc.sql("""
				select c.name, b.phase, b.stat, b.mean, b.sd
				from summary_band b
				join channel c on c.id = b.channel_id
				where b.baseline_id = :baseline""")
			.param("baseline", baselineId)
			.query((RowCallbackHandler) (rs) -> bands.computeIfAbsent(rs.getString("name"), (name) -> new HashMap<>())
				.put(rs.getString("phase") + "-" + rs.getString("stat"),
						new double[] { rs.getDouble("mean"), rs.getDouble("sd") }));
		return jdbc.sql("""
				select c.name, v.rank, v.persistent_z, v.deviation, v.max_abs_summary_z, v.longest_hold,
				       v.sf6_mean_z, v.sf6_sd_z, v.c4f8_mean_z, v.c4f8_sd_z
				from channel_verdict v
				join channel c on c.id = v.channel_id
				where v.baseline_id = :baseline and v.run_id = :run
				order by v.rank""")
			.param("baseline", baselineId)
			.param("run", runId)
			.query((rs, row) -> {
				String name = rs.getString("name");
				List<PhaseEvidence> phases = List.of(
						evidence(Phase.SF6, summaries.get(name), bands.get(name), decimal(rs, "sf6_mean_z"),
								decimal(rs, "sf6_sd_z")),
						evidence(Phase.C4F8, summaries.get(name), bands.get(name), decimal(rs, "c4f8_mean_z"),
								decimal(rs, "c4f8_sd_z")));
				return new Channel(name, rs.getInt("rank"), rs.getDouble("persistent_z"), rs.getBoolean("deviation"),
						rs.getDouble("max_abs_summary_z"), rs.getInt("longest_hold"), phases,
						excursions.getOrDefault(name, List.of()), holds.getOrDefault(name, List.of()));
			})
			.list();
	}

	/** Every hold of the run under the baseline, in channel and slot order, with the times of its slots. */
	private List<HoldView> holds(int baselineId, int runId, double[] slotTimes) {
		return jdbc.sql("""
				select c.name, h.start_slot, h.confirm_slot, h.end_slot, h.samples, h.value
				from hold h
				join channel c on c.id = h.channel_id
				where h.baseline_id = :baseline and h.run_id = :run
				order by c.name, h.start_slot""")
			.param("baseline", baselineId)
			.param("run", runId)
			.query((rs, row) -> {
				int start = rs.getInt("start_slot");
				int confirm = rs.getInt("confirm_slot");
				int end = rs.getInt("end_slot");
				RecipePosition position = GRID.position(start);
				return new HoldView(rs.getString("name"), start, confirm, end, position.cycle(), position.phase(),
						position.offset(), time(slotTimes, start), time(slotTimes, confirm), time(slotTimes, end),
						rs.getInt("samples"), real(rs, "value"));
			})
			.list();
	}

	/** @param channel only this channel's excursions, or every channel's when null */
	private List<Excursion> excursions(int baselineId, int runId, String channel, double[] slotTimes) {
		return jdbc.sql("""
				select c.name, e.start_slot, e.confirm_slot, e.end_slot, e.out_samples, e.peak_z
				from excursion e
				join channel c on c.id = e.channel_id
				where e.baseline_id = :baseline and e.run_id = :run
				  and (cast(:channel as text) is null or c.name = cast(:channel as text))
				order by c.name, e.start_slot""")
			.param("baseline", baselineId)
			.param("run", runId)
			.param("channel", channel, Types.VARCHAR)
			.query((rs, row) -> {
				int start = rs.getInt("start_slot");
				int confirm = rs.getInt("confirm_slot");
				int end = rs.getInt("end_slot");
				RecipePosition position = GRID.position(start);
				return new Excursion(rs.getString("name"), start, confirm, end, position.cycle(), position.phase(),
						position.offset(), time(slotTimes, start), time(slotTimes, confirm), time(slotTimes, end),
						rs.getInt("out_samples"), rs.getDouble("peak_z"));
			})
			.list();
	}

	/** The record time of every filled slot of a run, NaN for an empty one. Every channel shares its sample times. */
	private double[] slotTimes(int runId) {
		double[] times = new double[GRID.slotCount()];
		Arrays.fill(times, Double.NaN);
		jdbc.sql("""
				select slot, t_s
				from sample
				where run_id = :run and slot is not null
				  and channel_id = (select channel_id from sample where run_id = :run limit 1)""")
			.param("run", runId)
			.query((RowCallbackHandler) (rs) -> times[rs.getInt("slot")] = rs.getFloat("t_s"));
		return times;
	}

	private static PhaseEvidence evidence(Phase phase, Map<Phase, double[]> summaries, Map<String, double[]> bands,
			Double meanZ, Double sdZ) {
		double[] summary = (summaries == null) ? null : summaries.get(phase);
		double[] meanBand = (bands == null) ? null : bands.get(phase + "-MEAN");
		double[] sdBand = (bands == null) ? null : bands.get(phase + "-SD");
		return new PhaseEvidence(phase, part(summary, 0), part(summary, 1), part(meanBand, 0), part(meanBand, 1), meanZ,
				part(sdBand, 0), part(sdBand, 1), sdZ);
	}

	/** Out of the band first, then projected to leave it, then the rest. */
	private static int urgency(DriftProjection.State state) {
		return switch (state) {
			case OUT_OF_BAND -> 0;
			case WILL_EXIT -> 1;
			default -> 2;
		};
	}

	/** The latest fitted value's distance from the good runs' mean in their standard deviations, or the value's before a fit. */
	private static double distanceFromMean(DriftChannel channel) {
		DriftPoint latest = channel.points().get(channel.points().size() - 1);
		double value = (latest.fitted() != null) ? latest.fitted() : latest.value();
		return Math.abs(value - channel.bandMean()) / channel.bandSd();
	}

	private static Double finite(double value) {
		return Double.isFinite(value) ? value : null;
	}

	private static Integer boxed(OptionalInt value) {
		return value.isPresent() ? value.getAsInt() : null;
	}

	private static Double part(double[] pair, int index) {
		return (pair == null) ? null : pair[index];
	}

	private static Double time(double[] slotTimes, int slot) {
		double time = slotTimes[slot];
		return Double.isNaN(time) ? null : Double.valueOf(Float.toString((float) time));
	}

	private static Double real(ResultSet rs, String column) throws SQLException {
		float value = rs.getFloat(column);
		return rs.wasNull() ? null : Double.valueOf(Float.toString(value));
	}

	private static Double decimal(ResultSet rs, String column) throws SQLException {
		double value = rs.getDouble(column);
		return rs.wasNull() ? null : value;
	}

	private static Integer integer(ResultSet rs, String column) throws SQLException {
		int value = rs.getInt(column);
		return rs.wasNull() ? null : value;
	}

	private static Boolean bool(ResultSet rs, String column) throws SQLException {
		boolean value = rs.getBoolean(column);
		return rs.wasNull() ? null : value;
	}

	private static LocalDate date(ResultSet rs, String column) throws SQLException {
		Date value = rs.getDate(column);
		return (value == null) ? null : value.toLocalDate();
	}

	private static Phase phase(ResultSet rs, String column) throws SQLException {
		String value = rs.getString(column);
		return (value == null) ? null : Phase.valueOf(value);
	}

	private static List<Integer> integers(Array array) throws SQLException {
		List<Integer> values = new ArrayList<>();
		if (array != null) {
			for (Object value : (Object[]) array.getArray()) {
				values.add(((Number) value).intValue());
			}
		}
		return values;
	}

}
