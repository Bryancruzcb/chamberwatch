package io.github.bryancruzcb.chamberwatch.api;

import java.net.URI;

import io.github.bryancruzcb.chamberwatch.health.RefreshQueue;
import io.github.bryancruzcb.chamberwatch.recipe.RecipeGrid;
import io.github.bryancruzcb.chamberwatch.recipe.Source;
import io.github.bryancruzcb.chamberwatch.store.MeasurementSet;
import io.github.bryancruzcb.chamberwatch.store.ReadQueries;
import io.github.bryancruzcb.chamberwatch.store.RunId;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** The runs table, the run page with its charts, the wafer page, and relabeling. */
@RestController
@RequestMapping("/api/runs")
class RunsController {

	/** The most buckets one trace may return. */
	static final int MAX_POINTS = 20_000;

	private final ReadQueries queries;

	private final RefreshQueue refreshes;

	RunsController(ReadQueries queries, RefreshQueue refreshes) {
		this.queries = queries;
		this.refreshes = refreshes;
	}

	/**
	 * @param lot     a lot id, or every lot of the source
	 * @param flagged only flagged runs, only unflagged ones, or both
	 */
	@GetMapping
	ReadQueries.RunsPage runs(@RequestParam(name = "source", defaultValue = "PUBLIC") Source source,
			@RequestParam(name = "lot", required = false) Integer lot,
			@RequestParam(name = "flagged", required = false) Boolean flagged) {
		return queries.runs(source, lot, flagged);
	}

	@GetMapping("/{runId}")
	ReadQueries.RunDetail run(@PathVariable("runId") int runId) {
		return queries.run(runId).orElseThrow(() -> notFound("no run " + runId));
	}

	/** Without a cycle range, the whole record, before and after the etch included. */
	@GetMapping("/{runId}/channels/{channel}/trace")
	ReadQueries.Trace trace(@PathVariable("runId") int runId, @PathVariable("channel") String channel,
			@RequestParam(name = "fromCycle", required = false) Integer fromCycle,
			@RequestParam(name = "toCycle", required = false) Integer toCycle,
			@RequestParam(name = "maxPoints", defaultValue = "2000") int maxPoints) {
		if (maxPoints < 1 || maxPoints > MAX_POINTS) {
			throw badRequest("maxPoints must be from 1 to " + MAX_POINTS);
		}
		int cycles = RecipeGrid.STANDARD.cycles();
		if (outside(fromCycle, cycles) || outside(toCycle, cycles)
				|| (fromCycle != null && toCycle != null && fromCycle > toCycle)) {
			throw badRequest("cycles run from 1 to " + cycles + ", and fromCycle cannot come after toCycle");
		}
		return queries.trace(runId, channel, fromCycle, toCycle, maxPoints)
			.orElseThrow(() -> notFound("no channel " + channel + " in run " + runId));
	}

	@GetMapping("/{runId}/measurements")
	ReadQueries.Measurements measurements(@PathVariable("runId") int runId,
			@RequestParam(name = "set", defaultValue = "EIGHTY_NINE_POINT") MeasurementSet set) {
		return queries.measurements(runId, set).orElseThrow(() -> notFound("no run " + runId));
	}

	/**
	 * Records the label and answers 202 at once with the refresh it queued, which brings the good runs, the
	 * baseline and every assessment of the run's source in line with the label. The Location header is the
	 * refresh, which says when that is done.
	 */
	@PutMapping("/{runId}/label")
	@ResponseStatus(HttpStatus.ACCEPTED)
	ResponseEntity<RefreshReport> label(@PathVariable("runId") int runId, @RequestBody LabelChange change) {
		if (change == null || change.label() == null) {
			throw badRequest("a label change needs a label: AUTO, GOOD or BAD");
		}
		RefreshQueue.Status queued = refreshes.relabel(new RunId(runId), change.label())
			.orElseThrow(() -> notFound("no run " + runId));
		return ResponseEntity.accepted()
			.location(URI.create("/api/refreshes/" + queued.id()))
			.body(RefreshReport.of(queued));
	}

	private static boolean outside(Integer cycle, int cycles) {
		return cycle != null && (cycle < 1 || cycle > cycles);
	}

	private static ResponseStatusException notFound(String detail) {
		return new ResponseStatusException(HttpStatus.NOT_FOUND, detail);
	}

	private static ResponseStatusException badRequest(String detail) {
		return new ResponseStatusException(HttpStatus.BAD_REQUEST, detail);
	}

}
