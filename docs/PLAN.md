# Plan after v1

[DESIGN.md](DESIGN.md) is built, and this page is what comes next: the open questions that design recorded, a hosted demo, and the three additions the project set aside for a second phase. Each item says what is built, how it is checked, and when it counts as done. The status table at the end is updated in the same pull request as the work.

The phases run in this order. The open questions come first because two of them change the detectors, and the demo should show the detectors as they end up. The demo comes before the additions so there is a link to give out while the additions are built. The additions go from smallest to largest.

| Phase | What | Size |
|---|---|---|
| 1 | v1 as designed | done |
| 2 | Close the open questions | eight small pull requests |
| 3 | Hosted demo | one deployable, one box, one runbook |
| 4 | Predicted depth: a virtual metrology panel | one model, two endpoints, one panel |
| 5 | Optical emission spectra: 7.9 GB through a restartable batch job | the largest data work |
| 6 | A chamber simulator in C, streaming a live run over TCP | a second program and a live source |

## Phase 2: close the open questions

Every number claimed here is measured on the public data or the committed evaluation, and lands in the docs with the code.

### 2.1 Which reference the lot drift detector uses

The drift detector judges each lot's channels against the global good-run band, learned from the first three wafers of every lot. Conditioning shifts a lot's level, so a lot may start outside that band and be called out of band from wafer 4 with no trend at all. Measure on the public data, for every channel and lot, whether wafers 1 to 3 already sit outside the global band, and compare the verdicts under a per-lot reference: the lot's own first wafers set the level, the global band sets the width. Add `reference=GLOBAL|LOT` to `GET /api/lots/{lotId}/drift` and a switch on the lot page, default to the one the measurement favors, and write the comparison into DATA.md.

Done when: both references are served and shown, `DriftApiTest` covers both, and DATA.md has the per-lot table.

### 2.2 How many wafers per lot count as good runs

Held-out alarms were measured with wafers 1 to 3 and 2 to 4 as the good runs, never 1 to 2. Extend `PublicDataDetectionTest`'s held-out experiment to wafers 1 to 2 at every threshold, add the column to the table in DATA.md, and keep or change `goodRunsPerLot` on that evidence. A change moves the fingerprint of every baseline, so it comes with a note in DESIGN.md and a metrics rewrite if the evaluation moves.

Done when: the table has the third column and the default is justified by it.

### 2.3 A stuck-value detector

A sensor that holds its last value is invisible to a band detector, and v1 only simulates dropouts to zero. Learn, per channel, the longest run of identical readings the good runs show inside the etch, and flag a run whose channel holds one value for longer than that by a margin: the rule is calibrated from good runs like the bands are, so a gas flow reading 0 for a whole C4F8 phase, which every good run does, is never a flag. Add the fault kind `SENSOR_STUCK` to the simulator, holding the last value for 1 to 20 s, score it in the evaluation, store the flag on the assessment and the verdict, and show it on the run page as its own tag. The zero dropout stays.

Done when: the public good wafers raise no stuck flags, the evaluation reports recall and precision for `SENSOR_STUCK`, and the run page shows the flag.

### 2.4 Knock-on effects in the simulator

Simulated channels are independent, so ranking is never tested against a fault's own effects on other channels. Add one coupling with a stated model: a gas flow stuck low lowers the chamber pressure during that gas's phase in proportion to the missing flow, with the proportion chosen and documented, since the public data has no faults to measure it from. Then the evaluation says whether the stuck flow is still ranked first ahead of the pressure it moved. If ranking by earliest start no longer puts the cause first, that is the finding, and the ranking rule gets revisited.

Done when: the coupling is in the simulator and EVALUATION.md reports the first-channel rate with it.

### 2.5 How simulated lots drift

The simulator's drift is a straight line along the lot, which pushes wafers 9 and 10 over the run-level threshold on drifting channels. No public late wafer does that. Measure the public drift profile per channel, the mean of the SF6 phase mean by position in lot after removing each lot's level, and let the simulator draw a lot's drift as a scaled copy of that profile instead of a line. Recalibrate, rerun the evaluation, and report the late-wafer clean flag rate and the run-level share next to the public figures.

Done when: the simulated run-level alarm rate on late clean wafers is within the public rate's sampling error, and the metrics file is rewritten with the reason in EVALUATION.md.

### 2.6 A relabel that does not hold the request

A relabel that changes the good runs refits and rescores, 12 s on the public data on this machine and longer on a small host. `PUT /api/runs/{id}/label` answers 202 with a refresh id at once, the refresh runs on its own thread, `GET /api/refreshes/{id}` reports it, and the run page polls that until the current baseline moves. Two relabels in a row stay correct because the compare-and-set on the current baseline already handles a race.

Done when: the relabel test covers the 202 path and a double relabel, and the page shows the refit's result without holding the request.

### 2.7 Measured depth beside the flag

The README says every flag sits next to the measured result on the wafer, and the run page only links to it. Put the wafer's mean depth and its loss against the mean of its lot's first wafers on the run page as a stat, from the measurement table, for public runs that have a measurement.

Done when: run 55's page shows its depth and loss and the end-to-end test checks the numbers.

### 2.8 What cannot be fixed, said precisely

Three questions have no code answer. The thresholds rest on 10 lots: report the leave-one-lot-out alarm rates with their sampling error, so a reader sees the range. The gas lines are not named in the data; the dataset's readme confirms the recipe uses SF6 for etching and C4F8 for passivation but does not say which gas line carries which, so the inference stays and DATA.md says exactly that. The limit flags in lots 6 to 9 mark a change in the platen match network that did not cost depth; that is already stated, and 2.7 puts the depth beside the flag where a reader looks.

Done when: DATA.md carries the interval and the readme note.

## Phase 3: hosted demo

Worth doing: a link that works beats screenshots when someone has two minutes for the project. The data decides the shape. The public samples are 10.1 million rows, about 0.75 GB with their key, and the simulated lot adds a third of that, so the free database tiers do not hold it (0.5 GB at Neon, 1 GB at Aiven, and a free database that expires after 30 days at Render). A small virtual machine that runs PostgreSQL and the app together does, for about 12 dollars a month at 2 GB of memory or 6 at 1 GB with a swap file, paid from cloud credits that already exist.

### 3.1 One deployable

- The backend serves the built frontend: the Vite output is copied into the jar's static resources by the Docker build, and unknown paths outside `/api` forward to `index.html` so deep links work.
- A multi-stage Dockerfile: Node builds the frontend, Maven packages the jar without tests, a JRE 21 image runs it with `-XX:MaxRAMPercentage=75`.
- `CHAMBERWATCH_READ_ONLY=true` makes relabeling answer 403 as a problem detail and hides the label panel, so visitors cannot refit the demo's baseline.
- `CHAMBERWATCH_BOOTSTRAP=true` fills an empty database after the web server is up: download the public files from Zenodo, verify them against the committed checksums, run the ingest, then `simulate-lot`. Idempotent, so a restart does nothing when the data is there.
- The actuator exposes health only.

Done when: `docker compose up` on a clean machine serves the whole app with the public data and the simulated lot, and the tests cover the forward, the read-only refusal and the bootstrap's idempotence.

### 3.2 One box

Terraform in `deploy/` for one instance in us-west-2 (t4g.small, Ubuntu 24.04 on arm64, a security group open on 80 and 443, an Elastic IP), with user data that installs Docker, clones this repository, builds the image on the box and starts PostgreSQL, the app and Caddy. Caddy serves HTTPS on a sslip.io name made from the address, so no domain is needed. A `deploy/update.sh` pulls and rebuilds. `docs/DEPLOY.md` is the runbook: apply, first boot, update, destroy, and what it costs.

Done when: the README links the running demo and the runbook has been followed once from scratch.

## Phase 4: predicted depth

A virtual metrology panel: predict each wafer's mean etch depth from its telemetry and show it beside the measured value. The features already exist, the phase means and spreads of every channel in `run_phase_summary`. The model is ridge regression in plain Java, fitted and scored leave-one-lot-out so a lot never predicts itself, with the penalty chosen inside the folds. The honest comparison is against two baselines, the mean of the lot's first three wafers and a fit on position in lot alone, and the report says which features carry the prediction.

- `GET /api/runs/{id}/depth` gives the prediction, the measured mean where there is one, and the fold's error.
- `GET /api/reports/depth-model` gives the cross-validated error of the model and both baselines, and the coefficients.
- The wafer page gets the panel, the lots page gets predicted against measured by position.

Done when: the cross-validated error is reported next to the baselines in a new `docs/DEPTH.md`, whatever the result is.

## Phase 5: optical emission spectra

The dataset's ten daily files hold the plasma's emission spectra, 3,648 wavelengths from 185.89 to 883.97 nm at about 25 Hz with irregular timestamps, 476 to 834 MB per file and 7.9 GB in all, dictionary-encoded like the telemetry. This is the data work the design set aside.

- A Spring Batch job reads one daily file at a time, one wafer group per chunk, verifies the file against the committed checksums first, and records progress in the ingest ledger, so a crash resumes at the next wafer and a rerun reads nothing.
- The reduction: a handful of emission lines chosen after looking at the spectra (candidates are the fluorine lines near 703.7 and 685.6 nm, SiF near 440 nm and the CF2 band near 260 nm), each averaged into the recipe's 0.2 s slots. The spectra's timestamps are aligned to the telemetry by the plasma's onset, which both records show.
- The reduced lines become channels of the run, stored in the same sample table, so the bands, the detectors, the trace chart and the drift page take them without new code. DATA.md gains a section on the files and the alignment, and the README's data section says the spectra are optional.

Done when: the job loads all ten files here, a rerun adds nothing, the lines show on the run page, and the docs say what the spectra changed in the flags.

## Phase 6: a chamber simulator in C

A second program, `chamber-sim/`, in C11 with no dependencies: a recipe state machine (idle, stabilize, strike, the SF6 and C4F8 phases of 100 cycles, end), interlocks that refuse a step whose preconditions are not met, a chamber model with hidden state that produces the same 31 channels, seeded fault injection, and deterministic replay. It listens on a TCP port and streams one frame every 0.2 s as a line of JSON, and takes commands on the same connection. Tests in C run under `make test` in a third CI job.

ChamberWatch gains a live source: a client that connects to the simulator, records the frames as a run in progress, shows it on a live page that refreshes, and stores, aligns and scores the run when the recipe ends, through the same code path as every other run. The Java side is tested against a fake server; an integration test drives the real binary where a C compiler exists.

Done when: a run streamed from the simulator ends up scored in the runs table with its injected fault beside it, and the C tests and the Java tests pass in CI.

## Status

| Item | Pull request | State |
|---|---|---|
| 2.1 drift reference | | |
| 2.2 good runs per lot | | |
| 2.3 stuck-value detector | | |
| 2.4 knock-on effects | | |
| 2.5 drift profile | | |
| 2.6 relabel 202 | | |
| 2.7 depth beside the flag | | |
| 2.8 precise limits | | |
| 3.1 one deployable | | |
| 3.2 one box | | |
| 4 predicted depth | | |
| 5 emission spectra | | |
| 6 chamber simulator | | |
