# DESIGN.md: ChamberWatch

This is the UI style file: how the web app in `frontend/` looks and behaves. The system design (data, detectors, API, storage) is [docs/DESIGN.md](docs/DESIGN.md).

## The look in one sentence
Lab notebook: each page reads like a page of an engineering report, warm paper with ink rules, a serif headline that states the answer, and figures that carry the numbers, with their source or method a click away.

## Why it changed
The first style (2026-10, "Attention first") put every section in a soft gray rounded card, after Notion Calendar and Superhuman. Those are consumer productivity apps, and on a tool for reading sensor data the cards made every page look like the same generic dashboard. This style keeps the "answer first" rule and replaces the cards with figures.

## References
Browsed 2026-11-20 on the live sites.
- Our World in Data grapher (`ourworldindata.org/grapher/life-expectancy`): a serif title, a one-line definition under it, lines labeled at their ends instead of a legend box, and a source line under every chart.
- Vercel Observability (`vercel.com/products/observability`): an anomaly stated as one line of text over a chart with the bad window shaded, and a chart and its table in one frame.
- Honeycomb BubbleUp (`honeycomb.io/bubbleup`): the unusual cases compared against the baseline in small charts with one shared scale. Here: the lot-by-wafer grid on the Runs page and every channel on one scale on the run page.
- From Bryan's taste board: Brilliant's serif headline on warm off-white, and the calm, single-accent base of Things and Notion Calendar.

## Colors
Light is warm paper; dark is the same notebook at night. Only data carries color.

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--bg` (paper) | `#f7f4ec` | `#14130f` | page background |
| `--card` (tint) | `#eee8dc` | `#1d1b16` | the segmented switch, the selected lineup row, the etch timeline's lanes |
| `--card-2` | `#e4ddcd` | `#2a2720` | table hover and selection, tags, meter and bar tracks, the wafer disc |
| `--ink` | `#1c1a16` | `#efe9dc` | text, the rule above each figure, the limit line |
| `--ink-2` | `#48433a` | `#c9c1b0` | secondary text |
| `--ink-3` | `#686152` | `#a39a88` | labels, captions, axis ticks, source lines |
| `--line` | `#dcd4c3` | `#2f2b24` | hairlines inside figures and tables |
| `--line-strong` | `#bfb4a0` | `#4a4439` | axes, link underlines |
| `--out` | `#b3261e` | `#ff8a7d` | out of range |
| `--drift` | `#8a5300` | `#f2b452` | drift, heading out, stuck values |
| `--ok` | `#2c6e49` | `#74cf91` | in range, no trend |
| `--chan` | `#1f4e9c` | `#8fb0e8` | channel names in an answer, trace lines |
| `--dot-in` | `#857c6a` | `#7d7566` | the in-range dot and meter fill; 3:1 or better on the paper and on a track |
| `--grid-edge` | `#948b78` | `#6f6757` | the edge of each lot-grid cell and key swatch; 3:1 on the paper |

The lot grid shades in range by how close a wafer came to the limit (three warm grays) and out of range by how far past it went (three reds). Every cell has an edge, and an out-of-range cell carries a corner flag as well as its red, so neither the cell nor its state rests on a faint fill or on hue alone. A stuck value on the timeline is hatched for the same reason. The depth ramp stays blue.

## Type
- Headlines and figure titles: Newsreader (500), a serif drawn for reading on screens. The page's answer is the `h1` at 44px (34px on a phone); figure titles are `h2` at 22px.
- Text and controls: IBM Plex Sans, 15px base, line height 1.5.
- Wafer keys, channel codes and figures that line up: IBM Plex Mono and tabular numbers.
- Scale: 12 / 13 / 14 / 15 / 18 / 20 / 22 / 28 / 44; on a phone the `h1` drops to 34 and the lead paragraph to 16. Inline code and wafer keys are set at 0.9em and 0.95em of the text around them. Nothing renders below 12px.
- Fonts load from Google Fonts in `frontend/index.html`, with system fallbacks.

## Figures, not cards
- A section is a figure: a 1px ink rule across the top, the title, one sentence that answers it, the chart or table, then, where the numbers need it, a source line in `--ink-3` or a closed "How this is counted" disclosure. No background, no radius, no shadow.
- A figure set directly under the page's headline takes that headline as its answer and has no sentence of its own, as the lot grid does on the Runs page.
- Charts label their lines and marks directly where they can; a key is a short line of text with swatches, never a boxed legend, and it names only what the chart holds.
- Long methods stay in a closed "How this is counted" disclosure; a one-line definition may sit open as the source line.

## Spacing and shape
- Spacing steps: 4 / 8 / 12 / 16 / 24 / 32 / 40 / 64. Page width 1160px with a 24px gutter, 16px on a phone. Figures sit 32px apart down the page (24px on a phone) and 40px apart side by side.
- Radius: 6px for controls (buttons, selects, the segmented control's frame) and the floating readout; 4px for the buttons inside a segmented control; 2px for marks and their tracks (cells, swatches, bars, meters, tags); dots are circles. Nothing else is rounded, and a focus ring follows its element's radius.
- Shadows: none, except the chart readout, which floats.

## Components
- The app's own React components; no component library. `Segmented` for every switch, `Badge` and `RunStatus` for verdicts, `Icon` for Lucide icons.
- `LotGrid`: every wafer of a source, lots as rows and positions as columns, each cell a link to its run. One tab stop; the arrow keys, Home and End move between its links.
- `ChannelLineup`: every channel of a run on one how-unusual scale with the limit drawn once, in the detectors' rank.
- `ZMeter` for how unusual against the limit, on the same scale as the lineup.
- `EtchTimeline`, `LotDotPlot`, `RadialProfile`, `PredictionStrip`, `TraceChart`, `PositionChart`, `WaferMap` as before.

## Motion
- CSS only: the Runs panel fades in over 180 ms, ease-out, when a tab or source changes. Nothing else moves.
- Off under `prefers-reduced-motion`.

## Rules (every screen, always)
1. Skeleton loaders that match the final layout for anything that loads data (no layout shift). Skip them for near-instant loads.
2. Semantic colors from the table above. Never use color as the only signal; pair it with an icon, a shape or text.
3. No clutter: no subtitle that restates a heading, no redundant helper text, no decorative dividers, no duplicate labels. A source line is not clutter; it says where the figure comes from.
4. Accessibility, WCAG 2.2 AA: 4.5:1 text contrast (3:1 for large text and controls), full keyboard navigation with visible focus, a label on every input, aria-labels on icon-only buttons, alt text on meaningful images, semantic HTML, targets at least 24×24px, prefers-reduced-motion respected.
