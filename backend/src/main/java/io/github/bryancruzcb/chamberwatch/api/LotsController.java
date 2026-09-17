package io.github.bryancruzcb.chamberwatch.api;

import java.util.List;

import io.github.bryancruzcb.chamberwatch.detect.DriftReference;
import io.github.bryancruzcb.chamberwatch.recipe.Phase;
import io.github.bryancruzcb.chamberwatch.store.ReadQueries;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** The lot filter of the runs table, and the lot page. */
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

	/**
	 * Each channel's phase mean across the lot, with the drift detector's verdict as of every wafer. The band is
	 * centered on the good runs, or with {@code reference=LOT} on the lot's own first wafers.
	 */
	@GetMapping("/{lotId}/drift")
	ReadQueries.LotDrift drift(@PathVariable("lotId") int lotId,
			@RequestParam(name = "phase", defaultValue = "SF6") Phase phase,
			@RequestParam(name = "reference", defaultValue = "GLOBAL") DriftReference reference) {
		return queries.lotDrift(lotId, phase, reference)
			.orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "no lot " + lotId));
	}

}
