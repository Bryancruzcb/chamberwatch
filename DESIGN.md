# DESIGN.md: ChamberWatch

This is the UI style file: how the web app in `frontend/` looks and behaves. The system design (data, detectors, API, storage) is [docs/DESIGN.md](docs/DESIGN.md).

## The look in one sentence
Attention first: the top of the Runs page answers in plain facts which runs are out of range and where, the interface stays black and white like Notion Calendar, and only the data carries color, in soft gray cards like Superhuman's.

## References
- Notion Calendar (`notioncal-hero`): the interface itself is black and white; only the content carries color. Here the chrome is ink on white and the color belongs to out of range, drift, in range and the channel.
- Superhuman (`superhuman-cards`): soft gray cards with a small colored icon chip, under a row of tabs. Here each lot that needs a look, the first-channel count and the lot drift get one card each.
- The approved mockup: `ui-makeover-2026-10/chamberwatch/a/index.html`, direction A "Attention first".

## Colors
| Token | Light | Dark | Used for |
|---|---|---|---|
| `--bg` (background) | `#ffffff` | `#0e0e0e` | page background |
| `--card` (surface) | `#f4f4f2` | `#1a1a19` | cards, panels, the selected nav item |
| `--card-2` | `#e9e9e6` | `#262624` | tracks, tags, table hover |
| `--ink` (text) | `#161616` | `#f2f2ef` | body text, primary buttons, the limit line |
| `--ink-2` | `#47474a` | `#c4c4be` | secondary text |
| `--ink-3` (text-muted) | `#66666a` | `#a1a19b` | labels, captions, axis ticks |
| `--line` (border) | `#e0e0dc` | `#2d2d2b` | dividers, input borders |
| `--btn` (primary) | `#161616` | `#f2f2ef` | the one filled button; links are ink and underlined |
| `--focus` | `#1f5fbf` | `#8db7ff` | focus ring |
| `--ok` (success) | `#2b7a47` | `#74cf91` | in range, no trend |
| `--drift` (warning) | `#8f5200` | `#f2b452` | drift, heading out of the band, stuck sensor, degraded alignment |
| `--out` (danger) | `#c22f25` | `#ff8a7d` | out of range, out of the band, errors |
| `--chan` (info) | `#1f5fbf` | `#8db7ff` | channel names in the answer, the first-channel bars, the trace line |

Each semantic color has a `-wash` partner for icon chips and tags. The charts keep their own tokens (`--series-*`, `--seq-*`, `--band`) on the same base; the blue depth ramp is unchanged.

## Type
- The one answer per page: Instrument Serif 400, 44px (34px on a phone). Every page's `h1` uses it; a wafer key as a title uses Geist Mono instead.
- UI and body: Geist, weights 400/500/600, 15px base, line height 1.5.
- Wafer keys and recorded names: Geist Mono.
- Scale: 12 / 13 / 14 / 15 / 18 / 20 / 28 / 44. Nothing renders below 12px.
- Numbers that line up (stats, tables, meters): tabular figures, on the whole page.
- Fonts load from Google Fonts in `frontend/index.html`, with system fallbacks.

## Spacing and shape
- Spacing steps: 4 / 8 / 12 / 16 / 24 / 32 / 40 / 64. Page width 1160px with a 24px gutter, 16px on a phone.
- Radius: 8px for controls and segmented buttons, 10px for icon chips and the theme button, 16px for cards.
- Shadows: none, except the chart readout, which floats.

## Components
- The app's own React components; the repo has no component library and needs none. `Segmented` for every switch, `Badge` and `RunStatus` for verdicts, `ZMeter` for how unusual against the limit, `Icon` for Lucide icons.
- Buttons: primary = filled ink; secondary = segmented gray. There is no destructive action in the app.
- Cards: soft gray, no border, no shadow. No cards inside cards: stats inside a panel lose their own card.
- Tabs on the Runs page: Needs a look / All runs / In range, with counts. Tables turn into stacked rows on a phone.

## Motion
- CSS only: the Runs panel fades in over 180 ms, ease-out, when a tab or source changes. Nothing else moves.
- Off under `prefers-reduced-motion`.

## Icons and art
- Small UI icons: Lucide only, pasted as inline SVG in `frontend/src/components/Icon.tsx`.
- No decorative art. Charts are the pictures.

## Rules (every screen, always)
1. Skeleton loaders that match the final layout for anything that loads data (no layout shift). Skip them for near-instant loads.
2. Semantic colors (success, warning, danger, info) from the table above. Never use color as the only signal; pair it with an icon or text.
3. No clutter: no subtitle that restates a heading, no redundant helper text, no decorative dividers, no duplicate labels. If it isn't useful, remove it.
4. Accessibility, WCAG 2.2 AA: 4.5:1 text contrast (3:1 for large text and controls), full keyboard navigation with visible focus, a label on every input, aria-labels on icon-only buttons, alt text on meaningful images, semantic HTML, targets at least 24×24px, prefers-reduced-motion respected.
