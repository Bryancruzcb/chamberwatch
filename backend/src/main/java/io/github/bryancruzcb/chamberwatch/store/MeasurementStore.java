package io.github.bryancruzcb.chamberwatch.store;

import java.sql.Types;
import java.util.Arrays;
import java.util.List;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Stores wafer measurements. A location already stored for a run and set is left alone. */
@Repository
public class MeasurementStore {

	private final JdbcClient jdbc;

	private final JdbcTemplate jdbcTemplate;

	public MeasurementStore(JdbcClient jdbc, JdbcTemplate jdbcTemplate) {
		this.jdbc = jdbc;
		this.jdbcTemplate = jdbcTemplate;
	}

	/** @return rows inserted, which is fewer than {@code rows.size()} when some were already stored */
	public int insert(RunId run, MeasurementSet set, List<MeasurementRecord> rows) {
		int[][] counts = jdbcTemplate.batchUpdate("""
				insert into measurement (run_id, measurement_set, point_no, loc_id, x_um, y_um, preox_um, postox_um,
				                         postox_measured, stepheight_um, oxide_etch_um, si_etch_file_um)
				values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				on conflict do nothing""", rows, 500, (statement, row) -> {
			statement.setInt(1, run.value());
			statement.setString(2, set.name());
			statement.setInt(3, row.pointNo());
			if (row.locId().isPresent()) {
				statement.setString(4, row.locId().get());
			}
			else {
				statement.setNull(4, Types.VARCHAR);
			}
			statement.setDouble(5, row.xUm());
			statement.setDouble(6, row.yUm());
			statement.setDouble(7, row.preoxUm());
			statement.setDouble(8, row.postoxUm());
			statement.setBoolean(9, row.postoxMeasured());
			statement.setDouble(10, row.stepheightUm());
			statement.setDouble(11, row.oxideEtchUm());
			statement.setDouble(12, row.siEtchFileUm());
		});
		return Arrays.stream(counts).flatMapToInt(Arrays::stream).map((count) -> Math.max(count, 0)).sum();
	}

	public long count(MeasurementSet set) {
		return jdbc.sql("select count(*) from measurement where measurement_set = :set")
			.param("set", set.name())
			.query(Long.class)
			.single();
	}

}
