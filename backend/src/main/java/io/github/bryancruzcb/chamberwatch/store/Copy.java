package io.github.bryancruzcb.chamberwatch.store;

import java.io.IOException;
import java.io.StringReader;
import java.sql.Connection;
import java.sql.SQLException;

import javax.sql.DataSource;

import org.postgresql.PGConnection;

import org.springframework.jdbc.datasource.DataSourceUtils;

/** Streams CSV rows into a table with COPY, on the connection of the current transaction. */
final class Copy {

	private Copy() {
	}

	/** @param what names the rows in the error message */
	static void in(DataSource dataSource, String copySql, CharSequence csv, String what) {
		Connection connection = DataSourceUtils.getConnection(dataSource);
		try {
			connection.unwrap(PGConnection.class).getCopyAPI().copyIn(copySql, new StringReader(csv.toString()));
		}
		catch (SQLException | IOException ex) {
			throw new IllegalStateException("COPY failed for " + what, ex);
		}
		finally {
			DataSourceUtils.releaseConnection(connection, dataSource);
		}
	}

}
