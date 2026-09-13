package io.github.bryancruzcb.chamberwatch.store;

import java.util.Optional;

/**
 * One measured location on one wafer, with the file's raw columns. Depth is not a field: the database
 * derives it as step height minus remaining oxide, one formula for both files.
 *
 * @param experimentKey  {@code YYYY-MM-DD_NN}, matched to a run through {@code RunKey.experimentKey()}
 * @param pointNo        1-based order of the location within its wafer in the file
 * @param locId          B6, D4 and so on, only in the 9-point file
 * @param postoxMeasured false where the 89-point file marks {@code postox_thickness_nan} N/A, so
 *                       {@code postoxUm} is the file's interpolated value
 * @param siEtchFileUm   the file's own {@code si_etch}, kept for comparison, never charted
 */
public record MeasurementRecord(String experimentKey, int pointNo, Optional<String> locId, double xUm, double yUm,
		double preoxUm, double postoxUm, boolean postoxMeasured, double stepheightUm, double oxideEtchUm,
		double siEtchFileUm) {

	public MeasurementRecord {
		if (experimentKey == null || pointNo < 1 || locId == null) {
			throw new IllegalArgumentException("invalid measurement " + experimentKey + " point " + pointNo);
		}
	}

}
