package io.github.bryancruzcb.chamberwatch.api;

import java.util.List;

import io.github.bryancruzcb.chamberwatch.store.ReadQueries;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** The lot filter of the runs table. */
@RestController
@RequestMapping("/api/lots")
class LotsController {

	private final ReadQueries queries;

	LotsController(ReadQueries queries) {
		this.queries = queries;
	}

	/** Every lot, by source and lot number, with its run count and flagged runs. */
	@GetMapping
	List<ReadQueries.Lot> lots() {
		return queries.lots();
	}

}
