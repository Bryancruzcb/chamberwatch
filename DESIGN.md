# DESIGN.md: ChamberWatch

This is the UI style file: how the web app in `frontend/` looks and behaves. The system design (data, detectors, API, storage) is [docs/DESIGN.md](docs/DESIGN.md).

## The look in one sentence
Cassette: a lab notebook in true ink on warm paper, where every wafer is drawn as a disc, one red means out of range and nothing else, and each section is a numbered figure whose serif title and one-line answer sit over the chart that proves it.

## Why it changed again (2026-11-20)
The first style (2026-10, "Attention first") put every section in a soft rounded card, and every page looked like the same generic dashboard. The lab-notebook style that replaced it kept the answer-first rule but still read as plain: the wafer grid was rows of tan boxes, beige sat on beige, the charts and tables looked like library defaults, and there was too much text, with a raw file name as the run page's title. Cassette keeps the notebook and makes it bolder: black ink, a solid ink masthead, one saturated red, large mono numerals, and wafers as discs instead of boxes.

## Colors
Light is warm paper; dark is the same notebook at night, the same tokens swapped under `prefers-color-scheme: dark` (unless the theme button picked light) and under `[data-theme='dark']`.

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--paper` | `#f5efe2` | `#12110e` | page |
| `--paper-2` | `#ebe3d1` | `#1c1a16` | chart lanes, the baseline zone, a selected row |
| `--paper-3` | `#e0d5bd` | `#2b2720` | the good-run band, loading placeholders |
| `--ink` | `#14120f` | `#f2ece0` | text, the 2px figure rules, limit lines, the reading |
| `--ink-2` | `#3b362e` | `#cfc6b4` | secondary text, ticks, column heads |
| `--ink-3` | `#5c5547` | `#a69d8a` | source lines, a dashed ring |
| `--line` | `#d3c8b2` | `#2e2a23` | hairlines, the cassette rail |
| `--ring` | `#8f8572` | `#6d6556` | the in-range ring, a score line's axis, link underlines (3:1) |
| `--signal` | `#c4160c` | `#ff5a47` | out of range, and nothing else |
| `--on-signal` | `#f5efe2` | `#12110e` | a score printed inside a red disc |
| `--drift` | `#8a5300` | `#f2b452` | warning words such as "Stuck sensor" |
| `--band`, `--band-ink`, `--band-ink-2` | `#14120f`, `#f5efe2`, `#cfc6b4` | `#211e19`, `#f2ece0`, `#b5ab97` | the masthead |
| `--focus` | `#1f4e9c` | `#8fb0e8` | the focus ring on the paper; on the masthead it takes `--band-ink` |
| `--seq-1` to `--seq-6` | paper to ink | dark paper to light ink | depth on the wafer map and its profile, six steps; the lightest takes a `--ring` edge so it reads on the paper |

Charts are ink. A second series is dashed with hollow points, never a second hue. Red marks state, so it never decorates.

## Type
- Newsreader 600 for the `h1`, which states the page's answer (60px, 36px on a phone, at most 17 characters wide), for figure titles (`h2`, 28px, 24px on a phone) and for lot names in tables (20px).
- IBM Plex Sans for text and controls: 15px body, 20px lead under a page's answer (17px on a phone, and 17px under the run and lot pages' longer leads), 17px figure answers, 13px captions in `--ink-2`.
- IBM Plex Mono for figure numbers, column heads, ticks, scores, counts and the values at the ends of chart lines. Big numerals (28px; 72px for the verdict) carry the key numbers, never inside a box. A number set in mono never breaks from its unit.
- One scale, as tokens named for their size: `--text-12` / 13 / 15 / 17 / 20 / 24 / 28 / 36 / 60 / 72. Every `font-size` in the stylesheet is one of them; nothing renders below 12px. Fonts load from Google Fonts in `frontend/index.html`.

## Figures
- A section that shows data is a figure: a 2px ink rule, then `FIG. n`, the serif title and an optional control (such as the Source switch) on one line, then one sentence that answers it, then the chart or table. No background, no radius, no shadow.
- The number is a CSS counter on the figure, in page order, so a figure that is absent leaves no gap. Small panels with no data of their own take the rule and the title without a number.
- Headlines and answers state facts in plain words. Definitions and methods sit in closed disclosures.
- Charts label marks directly where they can; a key names only what its chart holds.

## Shared pieces (`frontend/src/components/` unless named)
- `Figure`: the rule, the counted label, the `h2`, an optional `control`, an optional `answer`, then children. `numbered={false}` for small panels; `busy` while it holds a placeholder.
- `Disc`: a wafer. In range is a hollow ring, out of range a solid red disc that may print its score, not scored or not aligned a dashed ring. Sizes `map` 46px (24px on a phone), `strip` 34px, `here` 48px, `ledger` 26px, `cluster` 32px, `mini` 18px on a 26 by 32px target, `key` 34px. A link with `to`, a name with `label`, a centre dot with `baseline`, the ink halo and `aria-current` with `current`.
- `ScoreLine`: a score on a line from 0 to a stated end: a 1px axis, a 2px ink tick at the limit, a red bar and dot out of range, a hollow ring on a stem in range, an arrow past the end. `size="verdict"` and `ticks` give the run page's large version; a limit within a fifth of 0 sets its label from the tick rightward and drops the 0, so the two never overlap. One column of lines shares one end, from `scoreLineEnd` in `charts/scale.ts`.
- `baselinePrefix` in `baseline.ts`: N when every lot keeps its baseline runs in its first N positions. Then one bracket marks them over those columns; otherwise each baseline disc carries a centre dot and the key says so.
- Ledger tables: mono 12px uppercase column heads over a 2px ink rule, hairline rows, numbers right-aligned in mono. Tags are words in mono capitals: ink for a role, `--drift` for a warning.
- `Segmented` is a text switch: a row of words, the one in effect 600 ink over a 2px ink underline. Tabs are the same with a 3px underline and a mono count. `Icon` keeps only functional icons (theme, retry).
- `LotGrid` (`charts/`) draws the Runs page's cassette map: lots as rows of discs on a rail, one tab stop, with arrows, Home and End to move.
- `LotStrip`: one lot as a row of `strip` discs, each a link to its run, under one bracket or with centre dots by the baseline rule. Feed it `lotStrip(rows, run)` from `run.ts` on the run page (that wafer drawn `here` with its score and a THIS WAFER label) or `lotWafers(rows, lotId)` on a lot's page (no wafer marked). `LotStripPlaceholder` holds its height while the runs load.
- `PositionChart` (`charts/`): values by wafer position in ink. `baseline={n}` shades positions 1 to n in `--paper-2` under a BASELINE label; `labelEnds` prints each line's last value at its end in mono 17px with the series name under it, pushed apart by `spreadLabels` in `charts/scale.ts`; `peak` annotates the first line's highest point. A band, a fitted line and its projection are optional. The pointer or the arrow keys read one wafer at a time.
- `Stat`: a mono label over a 28px mono numeral (`compact` for a name at 17px), under a hairline. Rows of them carry the wafer page's facts and the Live page's readings.
- `ErrorState` and `AnswerSkeleton` (`States.tsx`): what the API said, in a figure's place, with Try again; and a page's answer held at its own height while its data loads. Copy that differs by source (where the wafers come from, how an empty source fills) lives in `sources.ts`.

## The Runs page
- The `h1` counts the out-of-range runs, the count in `--signal` and plain text to a screen reader; the lead names the lot to start with.
- Fig. 1, the cassette map, with the Source switch in its head, usable while the map shows its placeholder. Then text tabs: Needs a look (Fig. 2, which channel left first, as red discs clustered by lot; Fig. 3, the out-of-range runs as one ledger on a shared score line and a shared time line; Fig. 4, drift along the lots), All runs and In range (the same ledger style, sortable, filtered by lot). The clean lots take one sentence and the page's words sit in a closed disclosure.

## The run page
- The `h1` is a sentence from the run's state, from `runHeadline` in `run.ts`: "Wafer 5 of Lot 6 is out of range.", "... is in range.", "... was not scored.", "... could not be aligned." The tab reads "Lot 6, wafer 5 · ChamberWatch". The file name sits on the meta line in mono, beside the date, the role and warning words and the two links.
- Above the `h1`, the lot strip: the lot's wafers as 34px discs (24px on a phone), each a link to its run; this wafer 48px (36px on a phone) with its score inside, an ink halo, `aria-current` and a THIS WAFER label. The wafers come from the runs list for the run's source; the strip holds its height while that loads and is left out if it fails. The baseline follows the Runs page's rule for one lot: one bracket over the first N, or a centre dot in each baseline disc.
- Beside the `h1`, the verdict, only when the run has a score and a baseline: HOW UNUSUAL, a disc and the score in mono 72px (60px on a phone, the nearest step), one sentence, and a `ScoreLine` from 0 to four limits or the score, rounded up to 5 and stopped at ten limits like every score line. A rule on its left, no box.
- Fig. 1, the timeline: one 26px `--paper-2` lane per channel along the etch, excursions in solid red, a stuck value hatched in ink, the injected fault as a dashed ink line, a leader at the first moment, and the score at the right in mono 20px after a state dot (solid red past the limit, a ring under it). A run no channel left shows the closest one on a score line; a run caught only on a phase mean or spread lists those channels.
- A simulated run adds the injected fault as a figure whose answer is whether the detectors caught it.
- Fig. 2, the lineup: lollipops against one 2px limit line, a heavy red stem and dot past the limit, a thin stem and a ring under it. The first ten by rank show (or every channel past the limit, if more); a button ("21 more channels, all under 3.0", `aria-expanded`) shows the rest in place and starts open when the channel in the address is one of them. The open row is tinted `--paper-2` with a 4px inset ink bar. How the rank works sits in a closed disclosure.
- Fig. 3, the trace: the reading as an ink min-max envelope, redrawn in red inside each excursion, a red rail of excursion ticks above the plot (stuck values hatched in ink on the same rail), the band in `--paper-3` with a direct label. The Etch and Cycles views fit the y axis with `fitTraceDomain` in `charts/trace.ts`, from the first bucket where the reading sits inside a settled band (one at most four times the view's median width), and print one note for what they clip ("Below 70 until 41.4 s; starts at 6.9"). Whole record shows everything. Phase statistics and holds follow as tables; every excursion sits in a closed disclosure.
- Label and Alignment are small panels: the rule and a 24px title, no number. Facts are a ruled list with mono labels.
- The lineup and the trace share a row 11 to 13, so the lineup's name column (256px) holds the longest channel name and its DEVIATES or STUCK word on one line, and every row keeps one height; a row grows only when its words cannot fit.

## The Lots page
- The `h1` is the answer, from `lotsAnswer` in `lotSummary.ts`: "Lots 6 to 9 hold all 15 out-of-range runs.", with the lead "The other 6 lots ran 60 wafers with none out of range." It has sentences for one lot, one run, every lot, none, a source with no baseline ("None of the 10 lots has been scored yet.") and an empty source ("No lots yet.").
- Fig. 1, Every lot, with the Source switch in its head: lot names in the serif at 20px, the date in mono, a Wafers column of `mini` discs from the source's runs list (one bracket over the column's head or centre dots by the baseline rule, a dotted divider after the baseline, a short dash for a slot the lot never ran), and the Out count as a 28px mono numeral that opens the lot's rows on the Runs page (a zero is 17px in `--ink-3`). The discs take no tab stop: the keyboard goes lot by lot, and each lot's page lists its wafers as links. A key under the table names only the marks it holds. While the runs load each row holds a placeholder; if they fail the column stays empty. On a phone each lot takes two lines, its name and count over its wafers at full size.
- Fig. 2, drift and depth by wafer position, as two `PositionChart`s with the baseline zone and end labels, the drift peak annotated. "Show as a table" and the method sit on one line under them.
- Fig. 3, public wafers only: depth predicted from the telemetry, measured solid against predicted dashed; beside it how far each guess misses as three bars on one scale with the value at each bar's end, the worst drawn hollow; one note line for the misses over every measured wafer; the five strongest features as a ruled list with mono values.
- The source line closes the page under a hairline.

## A lot's page
- Its lot strip over an `h1` in the run page's words, from `lotHeadline`: "Wafers 4 to 10 of Lot 6 are out of range.", "Every wafer of Lot 1 is in range.", "No wafer of Lot 6 has been scored yet." The lead, from `lotLead`, says how the rest divide when some were not scored or aligned, then how many channels' phase mean has left the band. The meta line holds the date, the conditioning, the wafer count and the link to the runs table.
- Fig. 1 scores every wafer in the runs table's ledger: a disc and words for its state, its score on one shared line, its first channel and when it left. Then the Phase and Reference switches over Fig. 2, the verdict counts as mono numerals and every channel with its verdict as a word (`--drift` for out of the band or heading out, ink for the rest), and Fig. 3, the picked channel's phase mean by position against its band and fitted line, its verdict word in the head and its wafers in a table. With the lot's own first wafers as the reference, the chart shades them as the baseline.

## The wafer page
- An `h1` from `waferHeadline` in `format.ts`: "Wafer 5 of Lot 6 etched deepest at its edge.", or at its center, or evenly; the mean when too few sites compare; "has no 9-point measurements" when the set is empty. The file name sits on the meta line.
- Fig. 1, the wafer map on the ink ramp, the 89-point or 9-point switch in its head, its facts as `Stat` numerals and the radial profile on the same ramp. Fig. 2, public wafers only: the predicted depth as an ink dot with the lot's typical miss as a band around it and the measured depth as an ink tick, on one line.

## The Live page and the rest
- The Live `h1` says what the chamber is doing, from `liveAnswer` in `live.ts`: "A wafer is being etched now." with where it is, "Nothing is being etched." with what the last recording came to, or "The last recording stopped." Fig. 1, the chamber now, as `Stat` readings over the actions, real buttons (Record filled in ink, the others drawn in ink); Fig. 2, the last wafer it recorded, with a link to its run. A read-only server says so in place of the buttons.
- An address with no page says "Nothing is at this address." with a link back to the runs.

## Spacing and shape
- Page width 1160px with a 24px gutter, 16px on a phone. Figures sit 48px apart (36px on a phone).
- Radius: discs and dots are circles; 6px on real controls (the theme button, buttons, selects) and the floating readout; 2px on bars and marks; nothing else is rounded.
- Shadows: none, except the chart readout, which floats. A disc's halo is an edge, not a shadow.

## Motion
- One 180 ms fade when a tab or source changes on the Runs page. Nothing else moves. Off under `prefers-reduced-motion`. A figure whose data is being replaced dims to half until the new answer arrives.

## Rules (every screen, always)
1. Placeholders that match the final layout for anything that loads data, so nothing jumps.
2. State is never carried by color alone: a solid disc with a number against a hollow ring against a dashed ring, and words next to marks.
3. No cards, chips, pills, tiles or boxed legends. No subtitle that restates a heading. A source line is not clutter.
4. Accessibility, WCAG 2.2 AA: 4.5:1 text contrast, 3:1 for marks and controls, full keyboard use with a visible focus ring on the paper and on the masthead, targets at least 24px, a label on every input, `prefers-reduced-motion` respected.
5. `frontend/src/designRules.test.ts` pins the radius, type scale, shadow, dark-token and token-only color rules against the stylesheet.
