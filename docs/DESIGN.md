# ChamberWatch v1 design

This is the design the code is built against. It came out of two competing sketches, one that kept every sample in PostgreSQL and one that stored aligned per-channel arrays, and it takes its base from the second. [Synthesis decision](#synthesis-decision) records what came from where. The data facts it relies on are in [DATA.md](DATA.md).

## Problem

ChamberWatch compares 96 wafer runs of one etch recipe at the same point in the recipe, learns what good runs look like there, flags runs that go out of range, flags lots that drift, and says which channel to look at first. The shape is not obvious because of the data. No column says which step a sample belongs to. Channels jump several-fold between the SF6 and C4F8 phases. Etches start 18 to 147 s into their records, and they start in three different ways. Lot 1 records 44 channels and the other lots 31. Detectors also have to be scored on 1,000 synthetic runs in CI, and the whole thing has to run on a laptop with about 1.5 GB of free memory.

The fixed stack is Java 21, Spring Boot 4.1 with JDBC and Flyway, PostgreSQL 18, React with TypeScript, and netCDF-Java `cdm-core` 5.10.0.

## Usage

### Commands

```bash
# Align the public wafers and print one line per wafer. Writes nothing.
java -jar backend/target/chamberwatch.jar align --data=data/public/zenodo17122442

# Load the public files, then fit a baseline and score every run. A rerun adds zero rows.
java -jar backend/target/chamberwatch.jar ingest --data=data/public/zenodo17122442

# Measure the simulator's template from the public wafers. Writes backend/src/main/resources/sim/template.tsv.
java -jar backend/target/chamberwatch.jar sim-template --data=data/public/zenodo17122442 --out=backend/src/main/resources/sim/template.tsv

# Store one seeded synthetic lot with known faults, for the UI.
java -jar backend/target/chamberwatch.jar simulate-lot --seed=7 --lot=901

# Drift score by position in lot next to measured depth, for the public data.
java -jar backend/target/chamberwatch.jar report --out=results/public-drift.json

# Score 1,000 seeded synthetic runs in memory and compare with results/metrics.json. No database.
./mvnw test -Dtest=EvaluationRegressionTest
```

With no command the jar serves the API on port 8080, with the OpenAPI description at `/v3/api-docs`.

### HTTP API

| Screen | Call |
|---|---|
| Runs table, lot filter | `GET /api/lots` |
| Runs table | `GET /api/runs?source=PUBLIC&lot=6&flagged=true` |
| Run page header, ranked channels, evidence | `GET /api/runs/{runId}` |
| Run page chart | `GET /api/runs/{runId}/channels/{channel}/trace?fromCycle=1&toCycle=100&maxPoints=2000` |
| Run page, mark good or bad | `PUT /api/runs/{runId}/label` with `{"label": "BAD"}` |
| Lot page | `GET /api/lots/{lotId}/drift?phase=SF6` |
| Wafer page | `GET /api/runs/{runId}/measurements?set=EIGHTY_NINE_POINT` |
| Lot list, public result | `GET /api/reports/drift-vs-depth` |

`lot` is a lot id from `/api/lots`, and `source` defaults to `PUBLIC`. On the public data `GET /api/runs?lot=6&flagged=true` returns the 7 flagged wafers of lot 6, among them wafer 5:

```json
{ "baseline": { "id": 1, "goodRuns": 30, "k": 6.0, "n": 5, "runZ": 5.0 },
  "runs": [ { "id": 55, "key": "Day_2024_08_01_Wafer_05", "lotId": 6, "lotNo": 6, "positionInLot": 5,
              "label": "AUTO", "alignment": "ALIGNED", "good": false, "scored": true,
              "limitFlags": 25, "deviationFlags": 0, "persistentZ": 18.810440063476562,
              "firstChannel": "PlatenRFLoadCapacitor", "firstTimeS": 407.2 } ] }
```

The trace call returns at most `maxPoints` buckets of consecutive samples, and the whole record when no cycle range is given. Each bucket carries its lowest and highest reading, so a one-sample spike survives downsampling, plus the cycle, phase and offset of its first slotted sample and the good-run band there. The channel's excursions come with it. Every read on the public data answers in under 100 ms, including 2,000 buckets of wafer 5's 3,246 PlatenRFLoadCapacitor samples.

A relabel answers once the refresh is done, so the next read already reflects it. Marking a flagged public wafer GOOD took 12 s, because a new set of good runs meant a refit and rescoring all 96 wafers. Putting it back to AUTO found the old baseline by its fingerprint and took 25 ms. Errors are RFC 9457 problem details: 404 for an unknown run or channel, 400 for a bad parameter or label.

The lot call returns every channel that has a good-run band on the phase mean. Each comes with the lot's wafers in position order, the fit of the wafers so far at each one, the drift state that fit gives, and the state as of the last wafer. Channels out of the band or projected to leave it come first. On the public data every lot call after the first answers in under 25 ms, and the states as of each lot's last wafer are exactly the table in [DATA.md](DATA.md#flags-and-measured-depth). The report averages each run's drift score by position in lot, next to mean depth and the depth lost since the lot's first 3 wafers, for each measurement set. On the 89-point file the depth loss grows from 0.27 µm at wafer 4 to 0.90 µm at wafer 10, and the mean drift score rises from 0.8 over wafers 1 to 3 to 1.36 at wafer 8.

### Web app

`frontend/` is a React app that reads only the HTTP API. Every response goes through a zod schema where it enters the app, so a field the server stops sending fails in one place instead of deep inside a page. The charts are SVG, with no chart library. The run page draws each trace bucket's lowest and highest reading against the good-run band, with the excursions shaded. The lot page plots a channel's phase mean by wafer against the band, with the fitted line dashed where it projects. The wafer page places every measured site on the wafer, shaded by depth on one blue ramp. The lots page puts the drift score and the depth loss by wafer position in two charts, never on two axes of one. The pointer or the arrow keys read one value at a time, and every chart has a table view. `npm run e2e` builds the app and drives the built bundle in Chromium, answering API calls with responses captured from the public data, so the tests need no backend.

### Java call sites

A unit test scores one synthetic run with no Spring and no database:

```java
@Test
void stuckSf6FlowIsCaughtOnGas5FlowFirst() {
    Simulator sim = Simulator.seeded(42, SimulationTemplate.bundled());
    Baseline baseline = HealthModel.fit(
        sim.cleanTrainingRuns(30).map(r -> Aligner.STANDARD.align(r.raw()).orElseThrow()),
        DetectorConfig.defaults());
    SimulatedRun simulated = sim.run(RunSpec.faulted(901, 2,
        FaultPlan.gasFlowStuckLow(ChannelName.GAS5_FLOW, 30.25, 0.45)));
    AlignedRun run = Aligner.STANDARD.align(simulated.raw()).orElseThrow();

    RunAssessment result = HealthModel.assess(run, baseline);

    assertThat(result.firstChannel()).contains(ChannelName.GAS5_FLOW);
    Excursion first = result.verdict(ChannelName.GAS5_FLOW).firstExcursion().orElseThrow();
    assertThat(run.timeAt(first.confirmSlot()) - simulated.fault().orElseThrow().startS()).isBetween(0.0, 6.0);
}
```

Ingest and relabeling both end in one call that converges:

```java
public Refresh refresh(Source source) {
    RunRoster roster = runs.roster(source);
    SortedSet<RunKey> good = GoodRuns.select(roster.candidates(), config.goodRunsPerLot());
    Fingerprint fingerprint = Fingerprint.of(source, good, config, Aligner.VERSION, HealthModel.VERSION);
    BaselineRef baseline = baselines.find(fingerprint)
        .orElseGet(() -> baselines.insert(source, fingerprint, roster.labelsSeq(), fit(good, roster), roster.ids()));
    int scored = scoreUnscored(baseline);
    boolean current = baselines.makeCurrent(baseline, roster.labelsSeq());
    baselines.prune(source, GENERATIONS_KEPT);
    return new Refresh(source, Optional.of(baseline), ...);
}
```

## Shape

### Data structures

`RecipeGrid` is the recipe as a value: 100 cycles, a 0.2 s slot, 30 slots for SF6 and 10 for C4F8, so 40 slots per cycle and 4,000 per run. `slot = (cycle - 1) * 40 + firstSlot(phase) + offset`. It is the only code that does slot arithmetic.

`RawRun` is a run as recorded: sample times rebased to zero, a `ChannelSet`, and decoded values. The netCDF reader and the simulator both produce it, so the aligner cannot tell them apart.

`AlignedRun` is the type every detector reads: a `float[channels * 4000]` of values by slot, a `float[4000]` of the sample time that filled each slot, and an `AlignmentReport`. NaN marks an empty slot. Its arrays are never written after construction. `Aligner.align` returns a sealed `AlignmentResult`, either `Aligned(AlignedRun)` or `Failed(key, reason)`, and `HealthModel.assess` only accepts an `AlignedRun`.

`Baseline` holds, per channel, a role (`INFORMATIVE` or `CONSTANT`), a mean and floored standard deviation per slot, and summary bands per phase and statistic. `RunAssessment` holds one `ChannelVerdict` per scored channel, in rank order.

### Storage

Every decoded value is a row: `sample(run_id, channel_id, sample_idx, t_s, value, slot)`, keyed by `(run_id, channel_id, sample_idx)`. `slot` is null for samples outside the grid: before the etch, after it, and the rare overflow sample. The public data is 10,132,286 rows, about 0.75 GB with the key. Keeping pre-etch and post-etch samples lets the run page chart the whole record, and keeping every value as a row lets SQL answer the read side.

`recipe_slot(slot, cycle, phase, offset)` has 4,000 rows. A Flyway migration fills it, and a test checks it against `RecipeGrid` so the two cannot drift apart. `band(baseline_id, channel_id, slot, mean, sd)` stores the per-slot bands, with `sd` null where a slot has a mean but no band, so the trace query can join the band to the samples.

The other tables are `lot`, `channel`, `ingest_file` (the ingest ledger), `run` (natural key, lot, position, the alignment report, label and label sequence), `run_phase_summary`, `measurement` (keyed by run, set and point number, with depth as a generated column `stepheight_um - postox_um`), `injected_fault`, `baseline` (unique fingerprint and the settings it was fitted with), `current_baseline` (one row per source), `baseline_good_run`, `baseline_channel` (each channel's role), `summary_band`, `run_assessment` (flag counts, the largest persistent z, and the first channel and excursion), `channel_verdict` and `excursion`. Assessments, verdicts and excursions are keyed by baseline, so a refit writes new rows beside the old ones, and moving the `current_baseline` row makes them current. That move is a single upsert that applies only when the stored `labels_seq` is not newer, so two refreshes can race without a lock.

The dominant reads:

- Run page trace: one `(run_id, channel_id)` range of the key, about 3,500 rows, bucketed with `ntile`, reduced to the minimum and maximum per bucket, then joined to `band` and `recipe_slot` on the bucket's first slot.
- Runs table: `run` joined to `run_assessment` under the current baseline, filtered by lot and flagged.
- Lot page: `run_phase_summary` for the lot's runs, with `regr_count`, `regr_avgx`, `regr_avgy`, `regr_sxx`, `regr_sxy` and `regr_syy` computed as window aggregates over the wafers so far, ordered by position. Those sums give the fit as of every wafer, which is what the detector would have said after each one.
- Scoring and refits: one `run_id` range of the key, about 110,000 rows, rebuilt into an `AlignedRun`.

### Module map

| Package | Owns | Framework types |
|---|---|---|
| `recipe` | Grid, channel names, raw and aligned runs, the aligner, phase summaries | none |
| `detect` | Good-run policy, band learning, limit detector, run deviation, ranking, drift projection, the `HealthModel` facade | none |
| `sim` | Seeded simulator and fault injection | none |
| `eval` | Evaluation harness, fault signatures, metrics and the metrics file | none |
| `ingest` | md5 checks, the netCDF, CSV and xlsx readers, the load | netCDF-Java inside one class |
| `store` | All SQL: `RunStore`, `BaselineStore`, `ReadQueries`, the COPY writer | JDBC |
| `health` | Refit, rescore, relabel, the current-baseline pointer | Spring `@Service` |
| `api` | Controllers, JSON views, error mapping | Spring MVC |
| root | Application, properties, the command-line commands | Spring Boot |

Dependencies point one way: `api` to `health` and `store`, `health` and `store` to `detect`, `detect` to `recipe`. `ingest` uses `store`, `health` and `recipe`, and `eval` uses `sim`, `detect` and `recipe`. The four pure packages import nothing from Spring or JDBC.

## Alignment

`Aligner.align(RawRun)` gives every sample a slot, once per run, at ingest or right after simulation.

1. Markers. A sample is SF6-on when Gas5Flow is at least 300, and C4F8-on when Gas4Flow is at least 150 and Gas5Flow is below 300. A run of on samples counts only when at least half of it is at etch power, SourceRFLoadPower of 1,000 or more, so the gas steps of a low-power plasma strike never count. A step between samples longer than 0.4 s is a gap. `RecipeGrid.gapStepSeconds()` holds that number for the aligner and the limit detector alike.
2. C4F8 phases. A run of C4F8-on samples lasting 0.6 to 2.2 s is a C4F8 phase. The 11.8 s pre-etch step with Gas4Flow at 300 is too long, and runs without power, so it does not count. The first C4F8 phase belongs to cycle 1.
3. SF6 onsets. For cycle k from 2 on, the SF6 onset is the start of the first SF6 run after C4F8 phase k-1, so a short dip inside an SF6 phase cannot move it. For cycle 1 it is the start of the SF6 run that ends within 0.6 s before C4F8 phase 1, and there may be none.
4. The walk. The aligner walks the cycles in time order like a metronome: the expected onset is the previous onset plus the median of the last five measured intervals, a run within 1.0 s of it is accepted, and otherwise the expected time is used and counted as predicted. A run that starts right after a recording gap may have lost its real onset, so it is never accepted. The walk ends when no etch phase follows, and that cycle is the run's last.
5. Slots. A sample between an onset and the next onset gets `offset = floor((t - onset) / 0.2 + 0.5)`. Samples between phases stay with the phase that just ended. An offset at or past the phase's capacity marks the sample as overflow and leaves its slot null. The last phase ends when its gas drops, plus one sample, and everything after it is post-etch.
6. Status. `Failed` means a marker channel is missing or there is no C4F8 phase at etch power. `DEGRADED` means a phase onset was predicted, a gap falls inside the etch, or a sample in cycles 2 to 99 overflowed. Anything else is `ALIGNED`. Degraded runs are scored but never picked as good runs automatically, and the run page shows why a run is degraded.

On the public data all 96 wafers align cleanly, and a test checks that wherever the data has been downloaded. 93 wafers have 99 C4F8 phases and end with cycle 100. Three have 98 and end with cycle 99, so their cycle 99 has no C4F8 phase. Cycle 1 has a 2.8 s SF6 phase in 65 wafers, a 4.2 to 4.4 s one in 10, and none in 21. SF6 phases fill at most 25 slots in steady cycles, and C4F8 phases at most 8. Recording gaps all fall after the etch. The one irregular cycle is cycle 74 of lot 3 wafer 7.

Cycles 1 and 100 differ between wafers, so v1 charts them and does not score them. The detectors score cycles 2 up to the run's second-to-last cycle. The last cycle ends the etch with the longer SF6 phase, so in the three wafers with 98 C4F8 phases cycle 99 looks like cycle 100 of the rest, and it stays out of the bands, the phase summaries and the limit detector.

## Detectors

`HealthModel` is the whole public surface of `detect`: three static pure functions.

```java
static Baseline fit(Stream<AlignedRun> goodRuns, DetectorConfig config)
static RunAssessment assess(AlignedRun run, Baseline baseline)
static DriftProjection project(LotFit fit, SummaryBand band, DriftRule rule)
```

Band learning streams one run at a time and keeps a count, a sum and a sum of squares per channel and slot. The mean is per slot. The standard deviation pools the variance over the same phase and offset in the two cycles on either side, so 30 good runs give about 150 observations per slot. It is floored at the larger of 5 percent of the channel's median pooled deviation and the channel's resolution, the smallest gap between two distinct good-run values, taken as 0 once a channel shows more than 4,096 distinct values. A slot gets a band only when a good run filled it and the pooled observations reach 5. A channel whose good runs never vary is `CONSTANT` and is never scored, which covers lot 1's 13 extra channels.

The limit detector walks slots in order and skips empty ones. `z = (x - mean) / sd`. A sample with `|z| > k` extends a streak, and an in-band sample, a slot without a band, or a gap resets it. When the streak reaches `n` samples the excursion is confirmed at that slot. The confirmation time is the alarm time used for latency, and the start slot is used for ranking. The same pass records each channel's persistent z, the largest `|z|` it held for `n` samples in a row, so a run has an excursion exactly when a persistent z passes `k`. That gives the runs table a severity to sort by and lets a threshold be tried without rescoring. Defaults are `k = 6` and `n = 5`, one second at 5 Hz.

The run deviation detector takes z-scores of each channel's phase mean and phase standard deviation against the good runs. A channel deviates when its largest `|z|` passes 5.

Both sketches started from `k = 3` and a run-level threshold of 4, numbers that assume noise independent from one sample to the next. Tool channels are smooth, so a wafer that sits 3 standard deviations off stays there for seconds and the persistence rule adds little. Scored against a baseline fitted without its own lot, 23 of the 30 good public wafers alarm at `k = 3`. The defaults are the smallest whole thresholds at which fewer than 10 percent of those held-out good wafers alarm: `k = 6`, where 2 of 30 do, and a run-level threshold of 5, where none do. [DATA.md](DATA.md#what-the-detectors-find) has the table, and `PublicDataDetectionTest` pins it.

Ranking puts channels with a confirmed excursion first, ordered by start slot, then larger peak `|z|`, then name. The rest follow by largest summary `|z|`. The earliest departure ranks first because later departures are often its effects: a stuck SF6 flow first, chamber pressure after.

Lot drift fits the SF6 phase mean of each channel against position in lot. `LotFit` is the least-squares fit as of one wafer. The lot page computes the same fits in SQL, as of every position. `LotFit.fromSums` turns the sums the regression aggregates keep into a fit, `LotFit.of` goes through the same method, and `DriftApiTest` holds each SQL fit to `LotFit.of` of the wafers so far. `HealthModel.project` turns a fit and the good runs' band, their SF6 phase mean plus or minus 3 standard deviations, into a state. The checks run in this order. Below 4 runs the state is `INSUFFICIENT_RUNS`. When the fitted value at the latest wafer is already outside the band it is `OUT_OF_BAND`, trend or not, so a lot that sits outside the band is never reported as flat. With a slope t-statistic under 2.5 it is `NO_TREND`. Otherwise the line is projected to the band edge in the slope's direction: `WILL_EXIT` with the runs remaining when the exit comes within a 10-wafer lot, and `STAYS_IN` otherwise.

Good runs are chosen in one place, `GoodRuns.select`: a run labeled GOOD, or a run labeled AUTO that is `ALIGNED` and among the first 3 wafers of its lot, closest to the clean. The chosen set is stored with the baseline, and every screen reads it from there.

## Ingest

1. Every file is md5-checked against `docs/zenodo17122442.md5` before anything is read. Only `DataFiles.verify` can produce a verified file, so an unchecked file cannot be opened by accident.
2. An `ingest_file` row per file and aligner version moves from `STARTED` to `COMPLETE`. A complete file is skipped.
3. The lot sheet is read with `java.util.zip` and StAX. Ten rows do not justify a spreadsheet library.
4. For each wafer group whose run key is not stored yet, `NetcdfTelemetrySource` reads the times, the channel names and the codes, and decodes them through the dictionary into a `RawRun`. The aligner runs in memory.
5. One transaction per wafer: `insert into run ... on conflict (run_key) do nothing returning id`, then the samples through `COPY`, then the phase summaries. With no id returned, another loader already stored the wafer and nothing more is written.
6. Measurements load keyed by run, set and point number. The 9 rows with blank keys are skipped and counted.
7. `HealthService.refresh(PUBLIC)` ends the command. The same files give the same good runs and the same fingerprint, so a rerun reuses the baseline and scores nothing.

A crash loses at most the wafer in flight, and a rerun resumes. Spring Batch is not used. The unit of work is a whole wafer, because alignment needs the full time series, and a transaction per wafer plus a natural key already gives restart. Batch would add a job repository to explain for one step.

## Evaluation

`Evaluation.run(EvaluationConfig, SimulationTemplate)` is pure and needs no database. It fits a baseline on 30 clean simulated runs, the first 3 wafers of 10 lots, then generates 1,000 test runs in lots of 10 with 100 faulted, 25 per kind, starting between cycle 5 and cycle 90. Each run is simulated, aligned, scored and dropped, so memory stays small.

The simulator seeds each run from the seed, the lot, the position and the purpose of the draw, so a run does not depend on generation order. It uses `StrictMath`, so a seed gives the same bits on Windows and Linux. A template measured once from the public wafers and committed gives, per channel and phase, the average shape, the per-cycle trend, lot and run levels, drift along the lot, slow wander, fast noise, and the swings good runs showed, so CI never needs the public files. Runs carry the public data's quirks: start offsets, the pre-etch steps, all three etch starts, the longer last SF6 phase, jitter, single-sample power dips, and gaps after the etch. The data cannot measure two settings, the shape of the lot-level distribution and the swing rate. Both were chosen so that simulated good wafers from unseen lots alarm like the public ones, and `SimulatorCalibrationTest` holds them there.

The four fault kinds are a gas flow stuck low, a pressure spike, a reflected power rise, and a sensor dropout to zero. A flow stuck below half its setpoint also hides its phase marker, so the aligner predicts onsets and marks the run degraded. That is evidence too, and the run page shows it.

`FaultSignature` maps the first matching excursion to the kind it looks like, so precision can be counted per kind. The metrics are precision and recall per kind, median detection latency in seconds after the fault starts, the share of clean runs flagged, and how often the rank 1 channel is the injected one. `results/metrics.json` has sorted keys and 4 decimals, and CI fails when a rate moves more than 0.02 or a latency more than 0.5 s. [EVALUATION.md](EVALUATION.md) has the model, the calibration and the results.

On public data the output is descriptive only: each run's drift score, the root mean square of its SF6-mean z-scores, averaged by position in lot, next to measured depth by position, with the 9-point and 89-point sets kept apart.

## Synthesis decision

The base is the aligned-profile sketch. Its interfaces are the deepest: one method hides alignment and three functions hide band learning, the persistence rule, ranking and projection. Its evaluation runs in memory and reproduces bit for bit, and its baseline lifecycle, a fingerprint plus a compare-and-set pointer, needs no locks.

Taken from the samples-in-PostgreSQL sketch:

- Every value stored as a row with its slot, instead of opaque per-channel arrays, so SQL does real work: trace downsampling with window functions, lot fits with `regr_*` window aggregates, and the drift-versus-depth report.
- `COPY` for the sample load.
- Measurements keyed by point number, since coordinates are not guaranteed unique.
- Pre-etch and post-etch samples kept for the chart.
- The observation that losing the gas pattern is itself a finding.

Rejected from the samples-in-PostgreSQL sketch:

- Band learning in SQL. The 1,000 evaluation runs never reach the database, so the bands would need a second definition in Java, or the evaluation would need a database.
- The good-run rule as a SQL function. It stays in `GoodRuns`, stored with the baseline, so the rule lives in one place.
- Per-kind precision computed by sharing false alarms across kinds in proportion. That is not a per-kind precision.

Rejected from the aligned-profile sketch:

- Profiles stored only as bytea. They are small, but nothing can query inside them.
- Its onset rules. Both sketches assumed 100 C4F8 phases and SF6 phases of 3.5 to 5.5 s, which is what the first written notes on the data said. The files show 99 C4F8 phases in most wafers and 98 in three, a cycle 1 SF6 phase that is 2.8 s, 4.2 to 4.4 s or missing, and low-power strike steps that look like etch phases unless the source power is checked. As written, both aligners would have degraded or rejected every public wafer. The alignment section above is rebuilt from the measured structure, and the 96-wafer test holds it there.

Both sketches agreed on no Spring Batch, a transaction per wafer as the unit of idempotency, ranking by earliest excursion start, `k = 3` and `n = 5`, depth as step height minus remaining oxide, and treating lot 1's extra channels as constant. The public data later moved `k` to 6, as [Detectors](#detectors) explains. The first sketch stopped before writing its tradeoffs, so its rationale above comes from its schema, its code sketch and the sections it finished.

## Tradeoffs accepted

- We accept about 0.75 GB of sample rows for the public data in exchange for SQL access to every value and one storage shape for every read.
- We accept a fixed grid of 100 cycles and 40 slots in exchange for constant-time positional access. A recipe change means a new aligner version and a realignment.
- We accept reading about 110,000 rows to score a stored run, where an array would be one row, in exchange for storage that SQL can read.
- We accept charting cycles 1 and 100 without scoring them in exchange for fewer false alarms from phases that legitimately differ between wafers.
- We accept lot fits in SQL and the projection in Java in exchange for a fit that is visible in SQL and a projection that is unit-tested.
- We accept assessments stored per baseline, three generations deep, in exchange for refits that never lock readers.

## Alternatives considered

- Per-channel aligned arrays in bytea, about 43 MB in total. Scoring is one read per channel, but SQL can join nothing to a value inside an array, so every chart and trend would need Java decoding.
- Bands learned with SQL aggregates. The band build becomes a showcase query, but evaluation runs never become rows, which forces either a database into the evaluation or two definitions of a band.
- Alignment on read from raw time-indexed samples. A grid change would need no reload, but the trickiest code would run on every read, refit and score.
- Time-warping each phase to a fixed length. Every slot fills, but seconds lose their meaning inside a phase, which blurs detection latency and the one-second power step at the start of each SF6 phase.

## Open questions and risks

- Should drift use the global good-run band, or each lot's own first wafers? Conditioning shifts lot levels, so some lots may start outside the global band.
- Would the first 2 wafers of each lot, closer to the clean, make a tighter reference than the first 3? Wafers 2 to 4 did no better than 1 to 3 on held-out alarms, and 1 to 2 has not been measured.
- The public data has no labeled faults, so the thresholds rest on held-out good wafers from only 10 lots. More lots would show more spread between lots and could move them.
- On the public data the limit flags mark a change in the platen match network in four lots, yet those wafers etch no shallower than wafers at the same position in other lots. A flag says the tool changed, not that the wafer is bad.
- A dropout that holds the last value is invisible to a band detector. v1 simulates dropouts as zeros. Is that acceptable?
- The gas identities are an inference. Nothing in the dataset names the gas lines.
- The simulator's drift is a straight line along the lot, so its wafers 9 and 10 cross the run-level threshold on drifting channels, which no public late wafer did. A drift that levels off, fitted per channel, may match better.
- Simulated channels are independent, so ranking is only tested against unrelated departures, never against a fault's own knock-on effects on other channels.
- A relabel that changes the good runs holds the request for about 12 s on the public data. If that gets in the way on the run page, the call can answer 202 and the page can wait for the current baseline to move.

## Next implementation step

The aligner, the ingest, the detectors, the stored baselines, the simulator, the evaluation, the HTTP API and the web app are built. Next are the `simulate-lot` and `report` commands.
