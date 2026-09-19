# Predicted depth

Depth is measured after the etch, on a few wafers, on a separate tool. The telemetry is recorded on every wafer while it etches. This page asks how much of a wafer's measured depth its own telemetry already says, which is what virtual metrology means in a fab: a number for every wafer between metrology runs, so drift shows up before the next measurement does.

The answer on this dataset is modest and worth stating plainly. A ridge regression on the phase summaries predicts a public wafer's mean 89-point depth to 0.162 µm root mean square when it is fitted without that wafer's lot. The wafers span 0.402 µm, guessing the overall mean gives 0.404 µm, and the best simple guess, a line on position in lot, gives 0.221 µm. So the telemetry carries real information beyond "wafers get shallower down the lot", and it is nowhere near a replacement for measuring.

## The data

96 public wafers in 10 lots. Depth is step height minus remaining oxide, averaged over a wafer's measured sites, as [DATA.md](DATA.md) sets out. 88 wafers are in the 89-point set and 75 in the 9-point set; the rest were not measured.

The features are the phase summaries already stored for every wafer, `run_phase_summary`: for each channel and each of the two phases, the mean and the spread over the scored cycles. 31 channels are recorded by every lot, which gives 124 features. 30 of them never vary across the public wafers and are dropped when a model is fitted, because a constant column carries nothing: `EpdIntensity`, `Gas3Flow`, `Gas8Flow`, `SourceRFTuningCapacitor` and the four `SourceRF2` channels, in one or both phases.

## The model

Ridge regression in plain Java, in `depth/`. Each feature is standardized on the training wafers, the target is centred, and the coefficients solve `(ZᵀZ + λI)β = Zᵀy`. There are fewer wafers than features, so `Ridge` solves the dual form, `(ZZᵀ + λI)α = y`, a Cholesky solve of one matrix per training set, as wide as that set has wafers, instead of 124 by 124, and maps `α` back. λ runs over 13 values from 10⁻³ to 10³.

Scoring is leave-one-lot-out: to predict a lot, the model is fitted on the other nine. Wafers in one lot share a chamber state, so leaving out single wafers would let a lot predict itself and flatter the result. λ is chosen the same way *inside* the training lots, by an inner leave-one-lot-out, so the held-out lot takes no part in choosing it either. The chosen penalty is 10 on the 89-point set and 31.6 on the 9-point set.

Two baselines make the number mean something:

- **Position in the lot.** A straight line on wafer position, fitted on the training lots. This is the drift the lot page already shows.
- **The lot's first wafers.** Guess a wafer's depth as the mean of its own lot's first three wafers. This needs those wafers measured, so it only scores wafers 4 and up, and the telemetry model is scored on the same wafers for that column.

## Results

Root mean square error in micrometres, every lot predicted without itself.

| Guess | 89-point, all 88 | 89-point, after wafer 3 (58) | 9-point, all 75 | 9-point, after wafer 3 (51) |
|---|---|---|---|---|
| Telemetry model | **0.162** | **0.156** | **0.151** | **0.132** |
| Position in the lot | 0.221 | 0.210 | 0.194 | 0.183 |
| The lot's first wafers | — | 0.708 | — | 0.671 |
| The overall mean | 0.404 | | 0.367 | |

The first-wafers guess is the worst of the three, which is the interesting part: within a lot the depth moves far more than the lot-to-lot spread, so anchoring on the lot's start is worse than ignoring the lot entirely. Wafer position explains much of that movement, and the telemetry cuts the error a further quarter below what position alone gives.

By wafer position the predictions track the measured fall of about 0.9 µm from wafer 1 to wafer 10, and drift apart at the end of the lot, where the mean prediction sits 0.10 and 0.13 µm deeper than measured at positions 9 and 10.

The features that weigh most in a fit on all ten lots, in micrometres per standard deviation of the feature:

| Feature | µm per sd |
|---|---|
| Foreline pressure, C4F8 spread | −0.066 |
| Platen RF load capacitor, SF6 spread | −0.066 |
| Source RF reflected power, C4F8 mean | −0.061 |
| Platen RF load capacitor, C4F8 spread | −0.052 |
| Platen RF peak to peak, C4F8 mean | −0.042 |

These are the same quantities the detectors flag: the platen match network's position, the reflected power, and the pumping line. Ridge spreads weight over correlated features, so the order is not a ranking of causes, and no single feature here would predict depth on its own.

## What this is not

88 wafers, 10 lots, one recipe, one chamber. The model is fitted and scored on wafers from the same short campaign, so it says what the telemetry explains *within* this dataset, not what it would do on a new chamber, a new recipe, or a tool after maintenance. It is a monitoring aid: it puts a number on every wafer between measurements, and its error is large enough that it cannot stand in for metrology or drive a control loop.

## A rounding bug that flattered the first result

The first run of this model reported 0.135 µm, and "endpoint intensity, SF6 spread" came out as its fourth strongest feature. `EpdIntensity` reads 0.123 in every scored sample of every public wafer, so its spread is 0. The stored value was 2.4e-8, left by the one-pass variance the aligner used, `(Σx² − n·mean²) / (n − 1)`. Standardizing turned that rounding into a feature, and what it encoded was each phase's sample count, because the rounding depends on how many values were summed. Sample count tracks how long the phases ran, which does relate to depth, so the model was reading a real signal through an accidental channel.

The summaries are now summed about each phase's first reading, which is exact for a flat phase, and a migration corrected the rows already stored. Every number on this page is from after that fix.

Whether the sample counts should be features on purpose is a fair question. Adding the two counts to the feature set gives 0.146 µm on the 89-point set and 0.149 on the 9-point set, better than 0.162 but short of the 0.135 the rounding produced. That result is not adopted here, because the feature set was fixed before the held-out scores were seen, and changing it afterwards would be choosing a model on the scores it is judged by. Phase durations belong in a later round, together with the rest of the timing the aligner already knows, scored the same way.

## Where the numbers come from

`PublicDataDepthTest` builds the features straight from the dataset files and pins every number in the table above; it runs wherever the data is downloaded and CI skips it. `DepthModelTest` and `RidgeTest` cover the model itself on small made-up data, including that a lot never predicts itself and that the dual solve matches the direct one.

The API serves the same report: `GET /api/reports/depth-model` for the table, the strongest features and the by-position curve, and `GET /api/runs/{runId}/depth` for one public wafer's prediction, its residual and its lot's error, both taking `set=NINE_POINT` or `set=EIGHTY_NINE_POINT`. The lots page shows the comparison, and a public wafer's page puts the predicted depth beside the measured one.
