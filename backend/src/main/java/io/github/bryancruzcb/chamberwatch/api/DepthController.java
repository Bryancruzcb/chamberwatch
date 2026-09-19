package io.github.bryancruzcb.chamberwatch.api;

import java.util.List;

import io.github.bryancruzcb.chamberwatch.depth.DepthData;
import io.github.bryancruzcb.chamberwatch.depth.DepthModel;
import io.github.bryancruzcb.chamberwatch.depth.DepthReport;
import io.github.bryancruzcb.chamberwatch.recipe.Source;
import io.github.bryancruzcb.chamberwatch.store.MeasurementSet;
import io.github.bryancruzcb.chamberwatch.store.ReadQueries;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Predicted depth: each public wafer's mean etch depth predicted from its telemetry by a model fitted without its lot,
 * and how that model compares with two baselines. Only the public wafers were measured, so only they have a model.
 * Each call reads the phase summaries and depths and fits the model again; on the public data that takes well under
 * a second, and it can never be stale.
 */
@RestController
@RequestMapping("/api")
class DepthController {

	private final ReadQueries queries;

	DepthController(ReadQueries queries) {
		this.queries = queries;
	}

	/**
	 * @param lambda the penalty of the model fitted on every lot, the one the coefficients come from
	 */
	record DepthModelView(MeasurementSet set, int wafers, int lots, int features, double lambda, List<MethodView> methods,
			List<DepthReport.Coefficient> strongest, List<DepthReport.PositionDepth> byPosition) {
	}

	/** @param all null for the first-wafers baseline, which can only score the wafers after the first ones */
	record MethodView(DepthReport.Method method, DepthReport.Errors all, DepthReport.Errors late) {
	}

	/**
	 * @param measuredUm null when the wafer was not measured in the set
	 * @param residualUm predicted minus measured, null when not measured
	 * @param lotRmseUm  the model's error over the measured wafers of the wafer's lot, all predicted without that lot
	 */
	record RunDepthView(int runId, MeasurementSet set, int lotNo, double predictedUm, Double measuredUm, Double residualUm,
			double lambda, Double lotRmseUm) {
	}

	@GetMapping("/reports/depth-model")
	DepthModelView model(@RequestParam(name = "set", defaultValue = "EIGHTY_NINE_POINT") MeasurementSet set) {
		DepthReport report = report(set);
		return new DepthModelView(set, report.wafers(), report.lots(), report.features(), report.lambda(),
				report.methods().stream().map((m) -> new MethodView(m.method(), m.all().orElse(null), m.late())).toList(),
				report.strongest(), report.byPosition());
	}

	@GetMapping("/runs/{runId}/depth")
	RunDepthView run(@PathVariable("runId") int runId,
			@RequestParam(name = "set", defaultValue = "EIGHTY_NINE_POINT") MeasurementSet set) {
		ReadQueries.RunDetail run = queries.run(runId).orElseThrow(() -> notFound("no run " + runId));
		if (run.source() != Source.PUBLIC) {
			throw notFound("depth is predicted for public wafers only; simulated wafers have no measured depth to learn from");
		}
		DepthReport.Prediction prediction = report(set).predictions()
			.stream()
			.filter((p) -> p.runId() == runId)
			.findFirst()
			.orElseThrow(() -> notFound("run " + runId + " has no phase summaries to predict from"));
		Double measured = prediction.measuredUm().isPresent() ? prediction.measuredUm().getAsDouble() : null;
		return new RunDepthView(runId, set, prediction.lotNo(), prediction.predictedUm(), measured,
				(measured == null) ? null : prediction.predictedUm() - measured, prediction.lambda(),
				prediction.lotRmseUm().isPresent() ? prediction.lotRmseUm().getAsDouble() : null);
	}

	private DepthReport report(MeasurementSet set) {
		return DepthModel.evaluate(DepthData.of(queries.depthWafers(Source.PUBLIC, set)), DepthModel.LAMBDAS)
			.orElseThrow(() -> notFound("no depth model: it needs measured wafers in at least " + DepthModel.MINIMUM_LOTS
					+ " lots of the " + set + " set"));
	}

	private static ResponseStatusException notFound(String detail) {
		return new ResponseStatusException(HttpStatus.NOT_FOUND, detail);
	}

}
