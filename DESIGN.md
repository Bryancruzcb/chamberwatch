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
| `--seq-1` to `--seq-6` | paper to ink | dark paper to light ink | depth on the wafer map |

Charts are ink. A second series is dashed with hollow points, never a second hue. Red marks state, so it never decorates.

## Type
- Newsreader 600 for the `h1`, which states the page's answer (60px, 36px on a phone, at most 17 characters wide), for figure titles (`h2`, 28px, 24px on a phone) and for lot names in tables (20px).
- IBM Plex Sans for text and controls: 15px body, 20px lead (17px on a phone), 17px figure answers, 13px captions in `--ink-2`.
- IBM Plex Mono for figure numbers, column heads, ticks, scores and counts. Big numerals carry the key numbers, never inside a box.
- One scale, as tokens named for their size: `--text-12` / 13 / 15 / 17 / 20 / 24 / 28 / 36 / 60 / 72. Every `font-size` in the stylesheet is one of them; nothing renders below 12px. Fonts load from Google Fonts in `frontend/index.html`.

## Figures
- A section that shows data is a figure: a 2px ink rule, then `FIG. n`, the serif title and an optional control (such as the Source switch) on one line, then one sentence that answers it, then the chart or table. No background, no radius, no shadow.
- The number is a CSS counter on the figure, in page order, so a figure that is absent leaves no gap. Small panels with no data of their own take the rule and the title without a number.
- Headlines and answers state facts in plain words. Definitions and methods sit in closed disclosures.
- Charts label marks directly where they can; a key names only what its chart holds.

## Shared pieces (`frontend/src/components/` unless named)
- `Figure`: the rule, the counted label, the `h2`, an optional `control`, an optional `answer`, then children. `numbered={false}` for small panels; `busy` while it holds a placeholder.
- `Disc`: a wafer. In range is a hollow ring, out of range a solid red disc that may print its score, not scored or not aligned a dashed ring. Sizes `map` 46px (24px on a phone), `strip` 34px, `here` 48px, `ledger` 26px, `cluster` 32px, `mini` 18px on a 26 by 32px target, `key` 34px. A link with `to`, a name with `label`, a centre dot with `baseline`, the ink halo and `aria-current` with `current`.
- `ScoreLine`: a score on a line from 0 to a stated end: a 1px axis, a 2px ink tick at the limit, a red bar and dot out of range, a hollow ring on a stem in range, an arrow past the end. `size="verdict"` and `ticks` give the run page's large version. One column of lines shares one end, from `scoreLineEnd` in `charts/scale.ts`.
- `baselinePrefix` in `baseline.ts`: N when every lot keeps its baseline runs in its first N positions. Then one bracket marks them over those columns; otherwise each baseline disc carries a centre dot and the key says so.
- Ledger tables: mono 12px uppercase column heads over a 2px ink rule, hairline rows, numbers right-aligned in mono. Tags are words in mono capitals: ink for a role, `--drift` for a warning.
- `Segmented` is a text switch: a row of words, the one in effect 600 ink over a 2px ink underline. Tabs are the same with a 3px underline and a mono count. `Icon` keeps only functional icons (theme, retry).
- `LotGrid` (`charts/`) draws the Runs page's cassette map: lots as rows of discs on a rail, one tab stop, with arrows, Home and End to move.

## Spacing and shape
- Page width 1160px with a 24px gutter, 16px on a phone. Figures sit 48px apart (36px on a phone).
- Radius: discs and dots are circles; 6px on real controls (the theme button, buttons, selects) and the floating readout; 2px on bars and marks; nothing else is rounded.
- Shadows: none, except the chart readout, which floats. A disc's halo is an edge, not a shadow.

## Motion
- One 180 ms fade when a tab or source changes on the Runs page. Nothing else moves. Off under `prefers-reduced-motion`.

## Rules (every screen, always)
1. Placeholders that match the final layout for anything that loads data, so nothing jumps.
2. State is never carried by color alone: a solid disc with a number against a hollow ring against a dashed ring, and words next to marks.
3. No cards, chips, pills, tiles or boxed legends. No subtitle that restates a heading. A source line is not clutter.
4. Accessibility, WCAG 2.2 AA: 4.5:1 text contrast, 3:1 for marks and controls, full keyboard use with a visible focus ring on the paper and on the masthead, targets at least 24px, a label on every input, `prefers-reduced-motion` respected.
5. `frontend/src/designRules.test.ts` pins the radius, type scale, shadow, dark-token and token-only color rules against the stylesheet.
