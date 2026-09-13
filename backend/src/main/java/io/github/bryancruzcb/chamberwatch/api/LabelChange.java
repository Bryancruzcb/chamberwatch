package io.github.bryancruzcb.chamberwatch.api;

import io.github.bryancruzcb.chamberwatch.detect.Label;

/** The body of a relabel: {@code {"label": "BAD"}}. */
record LabelChange(Label label) {
}
