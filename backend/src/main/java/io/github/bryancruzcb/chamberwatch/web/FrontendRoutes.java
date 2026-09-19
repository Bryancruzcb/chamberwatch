package io.github.bryancruzcb.chamberwatch.web;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

/**
 * The web app's own pages. The built app is served from the jar's static resources, and a link to one of its
 * pages, opened directly or reloaded, has to answer with {@code index.html} so the app can route it. The paths
 * mirror the app's router; everything under {@code /api} stays with the controllers.
 */
@Controller
class FrontendRoutes {

	@GetMapping({ "/runs/**", "/lots/**" })
	String app() {
		return "forward:/index.html";
	}

}
