package io.github.bryancruzcb.chamberwatch.detect;

import io.github.bryancruzcb.chamberwatch.recipe.PhaseSummary;

/** The run summary statistics that the run-level detector compares against good runs. */
public enum SummaryStat {

	MEAN,

	SD;

	public double of(PhaseSummary summary) {
		return (this == MEAN) ? summary.mean() : summary.sd();
	}

}
