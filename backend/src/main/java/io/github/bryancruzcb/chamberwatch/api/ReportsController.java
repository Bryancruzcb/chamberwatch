package io.github.bryancruzcb.chamberwatch.api;

import io.github.bryancruzcb.chamberwatch.recipe.Source;
import io.github.bryancruzcb.chamberwatch.store.ReadQueries;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Results across lots. */
@RestController
@RequestMapping("/api/reports")
class ReportsController {

	private final ReadQueries queries;

	ReportsController(ReadQueries queries) {
		this.queries = queries;
	}

	/** Drift score and measured depth by position in lot, for the lot list. */
	@GetMapping("/drift-vs-depth")
	ReadQueries.DriftVsDepth driftVsDepth(@RequestParam(name = "source", defaultValue = "PUBLIC") Source source) {
		return queries.driftVsDepth(source);
	}

}
