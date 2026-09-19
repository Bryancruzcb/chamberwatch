package io.github.bryancruzcb.chamberwatch.api;

import io.github.bryancruzcb.chamberwatch.health.RefreshQueue;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** The refreshes relabels start, which the run page polls until the baseline follows the new label. */
@RestController
@RequestMapping("/api/refreshes")
class RefreshesController {

	private final RefreshQueue refreshes;

	RefreshesController(RefreshQueue refreshes) {
		this.refreshes = refreshes;
	}

	@GetMapping("/{refreshId}")
	RefreshReport refresh(@PathVariable("refreshId") long refreshId) {
		return refreshes.status(refreshId)
			.map(RefreshReport::of)
			.orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
					"no refresh " + refreshId + " among the last " + RefreshQueue.REMEMBERED + " since the app started"));
	}

}
