# Data

ChamberWatch runs on one public dataset. This page covers where it comes from, how to download it, what each file holds, and the quirks the code has to handle. Every number here was measured on the downloaded files on 2026-09-12.

## Source

"A Multi-Model Dataset for BOSCH Plasma-Etching: Optical Emission Spectra, Process Parameters, and Wafer Measurements for Data-Driven Plasma Modeling", by M. A. Sayyed and co-authors at Chemnitz University of Technology and Fraunhofer ENAS. Published on Zenodo on 2025-09-15 as record [17122442](https://zenodo.org/records/17122442) under CC BY 4.0.

The data is never committed. `data/` is in `.gitignore`.

## Download

| File | Bytes | Used for |
|---|---:|---|
| `Process_data.nc` | 8,819,467 | Tool telemetry for every wafer |
| `Dictionary_process.nc` | 88,084 | Decoder for the telemetry values |
| `Si_Oxide_etch_9_points.csv` | 46,954 | Wafer measurements at 9 points, taken on the day |
| `Si_Oxide_etch_89_points.csv` | 647,752 | Wafer measurements at 89 points, taken again in 2025 |
| `Lot_status.xlsx` | 11,954 | Lot dates and chamber conditioning |
| `Readme.pdf` | 359,703 | Dataset description |
| `Wafer_layout.pdf` | 25,434 | Measurement locations |

The MD5 sums are in [`zenodo17122442.md5`](zenodo17122442.md5). The ten daily optical emission files, 476 to 834 MB each, and `Dictionary_OES.nc` are not used in v1.

From the repository root:

```bash
mkdir -p data/public/zenodo17122442
cd data/public/zenodo17122442
for f in Process_data.nc Dictionary_process.nc Si_Oxide_etch_9_points.csv \
         Si_Oxide_etch_89_points.csv Lot_status.xlsx Readme.pdf Wafer_layout.pdf; do
  curl -fL -o "$f" "https://zenodo.org/api/records/17122442/files/$f/content"
done
md5sum -c ../../../docs/zenodo17122442.md5
```

## The experiment

The Readme describes the recipe as a 1 s ignition, then 100 cycles of 4.5 s of SF6 etching and 1.5 s of C4F8 passivation. The wafers are 200 mm silicon with a 1 µm oxide mask. The telemetry shows a slightly different structure, covered under [Recipe position](#recipe-position).

Before each lot the chamber was cleaned, then conditioned 1, 3 or 9 times on the chuck, on a silicon wafer, or on an oxide wafer. The lot's wafers then ran one after another, a minute apart, with no clean in between. Lot 7 has 6 wafers because the last 4 were damaged.

| Lot | Date | Wafers | Conditioning | 9-point data | 89-point data |
|---|---|---:|---|---|---|
| 1 | 2024-07-02 | 10 | 3 times on the chuck | 10 wafers | 9 wafers, no wafer 7 |
| 2 | 2024-07-05 | 10 | once on the chuck | 10 wafers | 10 wafers |
| 3 | 2024-07-09 | 10 | 9 times on the chuck | 10 wafers | 10 wafers |
| 4 | 2024-07-11 | 10 | 3 times on a Si wafer | 10 wafers | 10 wafers |
| 5 | 2024-07-19 | 10 | once on a Si wafer | 10 wafers | 10 wafers |
| 6 | 2024-08-01 | 10 | 9 times on a Si wafer | 10 wafers | 10 wafers |
| 7 | 2024-08-05 | 6 | 3 times on an oxide wafer | wafers 1 to 5 | 6 wafers |
| 8 | 2024-08-07 | 10 | 3 times on an oxide wafer | none | 10 wafers |
| 9 | 2024-08-21 | 10 | 3 times on the chuck | 10 wafers | 9 wafers, no wafer 9 |
| 10 | 2024-08-22 | 10 | 3 times on an oxide wafer | none | wafers 1 to 4 |

`Lot_status.xlsx` lists 89-point data for all 10 wafers of lot 10, but the CSV holds only wafers 1 to 4.

## Telemetry

`Process_data.nc` is NetCDF-4 on HDF5, compressed with zlib level 9 and the shuffle filter. It has one group per wafer, named `Day_YYYY_MM_DD_Wafer_NN`, with three variables.

| Variable | Type | Dimensions | Meaning |
|---|---|---|---|
| `times` | float64 | time | Seconds. The unit attribute says seconds since 1970-01-01, but the values are offsets within the record, and the first sample is 0 to 143 s in. |
| `feature` | string | feature | Channel names, all prefixed `Stat3_Etch_MV_`. |
| `data` | uint16 | time, feature | Codes. A value is the entry at that code in the `data` variable of `Dictionary_process.nc`, which holds 49,290 sorted float32 values. |

netCDF-Java `edu.ucar:cdm-core` 5.10.0 reads the file, strings and unsigned codes included, and decodes all 96 groups in about 0.3 s.

- Sampling is 5 Hz: 0.2 s steps with 0.01 s of jitter.
- Each wafer has 3,193 to 3,835 samples. In total there are 313,169 sample times and 10,132,286 values.
- Lot 1 has 44 channels and lots 2 to 10 have 31. The 13 channels that only lot 1 has are all constant: Gas6Flow, Heater5Temp to Heater8Temp, SourceRFLoadCapacitor, SourceRF2LoadCapacitor, ThermoCouple1Temp to ThermoCouple4Temp, attenuatorRatio and moriOuterCurrent.
- Gas3Flow, Gas8Flow, SourceRF2LoadPower and SourceRF2ReflectedPower are constant in every wafer. EpdIntensity is constant in 86 of the 96. Heater1Temp stays at 1371.
- 69 of the 96 wafers have one gap in the record, 41 to 45 s long, starting 639 to 670 s after the first sample. The gap always comes after the etch has ended. Lots 9 and 10 have no gaps.
- The dataset does not state units for the channels.

### Recipe position

The file has no step or cycle column, so ChamberWatch derives the recipe position from the gas flows and the source power. The etch runs with SourceRFLoadPower at about 2,790. A plasma strike runs at about 140, and its gas steps can look exactly like etch phases, so only gas stretches at etch power count.

- A C4F8 phase is a stretch where Gas4Flow is at least 150 while Gas5Flow stays below 300, at etch power. It lasts 1.2 to 1.4 s at 5 Hz, at most 8 samples. 93 wafers have 99 of them. Three have 98: lot 3 wafer 10, lot 4 wafer 9, and lot 5 wafer 2.
- An SF6 phase is a stretch where Gas5Flow is at least 300, at etch power. Between two C4F8 phases it lasts 4.2 to 4.4 s, 22 or 23 samples. One cycle, from one SF6 onset to the next, takes 5.8 to 6.2 s and usually 6.0 s.
- Every etch ends with an SF6 phase after its last C4F8 phase. It runs 4.4 to 4.6 s at etch power, and its gas stays on for about another second after the plasma stops.
- Etches start in one of three ways. In 65 wafers a 2.8 s SF6 phase comes right before the first C4F8 phase, and in 10 that SF6 phase lasts 4.2 to 4.4 s. In the other 21 the etch starts directly with a C4F8 phase.
- Some wafers show strike steps at low power before the etch, followed by about 10 s with no gas flow and no power. In lot 1 wafer 2 the strike ran SF6 gas for 2.8 s. In lot 3 wafer 10, one of the three wafers with 98 C4F8 phases, it ran C4F8 gas for 1.4 s and then SF6 gas for 1.2 s.
- Inside the etch, the source power drops below 1,000 for a single sample in 56 wafers.
- The etch starts 18 to 147 s into the record and lasts about 592 to 599 s. The aligner's etch span, which ends when the last SF6 gas stops, runs 593 to 600 s.
- One cycle in the dataset is irregular: in lot 3, wafer 7, cycle 74 ran its SF6 phase for 5.0 s and its C4F8 phase for 0.8 s.

The dataset does not label its gas lines. Gas5 as SF6 and Gas4 as C4F8 is an inference from the flows and the duty cycle, which match the recipe.

Channels jump between phases, so two wafers compared at the same clock time are often in different steps:

| Channel | SF6 phase | C4F8 phase |
|---|---|---|
| PlatenRFLoadPower | about 79 for the first second, then about 29 | about 39 |
| SourceRFReflectedPower | 35 to 60 | 400 to 480 |
| ForeLinePressure | about 150 | about 80 |
| Pressure | about 0.040 | about 0.050 |

Before the etch, the tool runs Gas1Flow at 150 and Gas4Flow at 300 for 11.8 s and brings the helium backside pressure up to 15. A rule that looks only at Gas4Flow would count that step as a C4F8 phase, which is why the phase rule above also bounds the length. Short SF6 steps of 1.2 to 1.4 s run before the etch too. During the source plasma strike, SourceRFReflectedPower reads 1000, its highest value anywhere in the file.

## Wafer measurements

All lengths are in micrometres, including the X and Y coordinates.

`Si_Oxide_etch_9_points.csv` was measured on the day of each lot at 9 locations on a 19 mm grid: B6, D4, D8, F2, F6, F10, H4, H8 and J6. Its columns are experiment_key, lot_number, wafer_number, loc_id, X, Y, preox_thickness, postox_thickness, stepheight, oxide_etch and si_etch.

The last 9 rows of that file have no experiment_key, lot or wafer. Comparing their pre-etch oxide readings with the 89-point file does not identify a wafer, because the same comparison cannot tell two known wafers apart either. ChamberWatch skips those rows.

`Si_Oxide_etch_89_points.csv` was measured again in February 2025, with different instruments, at 89 locations. Its columns are experiment_key, lot_number, wafer_number, X, Y, preox_thickness, postox_thickness, postox_thickness_nan, stepheight, oxide_etch and si_etch. Per the Readme, the pre-etch oxide was interpolated from 15 measured points. Where the post-etch oxide reading failed, `postox_thickness_nan` reads `N/A`, 157 cells in all, and `postox_thickness` holds an interpolated value.

`experiment_key` is `YYYY-MM-DD_NN`, the lot date and the wafer number. It matches the telemetry group `Day_YYYY_MM_DD_Wafer_NN`.

### Two formulas for etch depth

The files compute `si_etch` differently, and each formula holds for every row of its file:

- 9-point file: `si_etch = stepheight - oxide_etch`
- 89-point file: `si_etch = stepheight - postox_thickness`

A step height taken with the mask still in place spans the remaining oxide plus the etched silicon, so ChamberWatch computes depth as `stepheight - postox_thickness` for both files and keeps the raw columns. On the 9-point file that reads 0.235 µm deeper than the file's own `si_etch`, on average. The Readme does not give either formula.

The two files still disagree by about 3 µm on mean depth, because the instruments, the locations and the measurement dates differ. ChamberWatch never mixes the two in one chart.

## What the telemetry shows

This is a first look, not a result. The correlations below are within lots: each lot's mean was removed first, so differences between lots do not count. Channel values are per-wafer means over the samples where Gas5Flow is above 300, and depth is the per-wafer mean of the 89-point file.

| Measure | Against position in the lot | Against measured depth |
|---|---:|---:|
| Measured depth | -0.85 | |
| PlatenRFTuningCapacitor | +0.90 | -0.80 |
| PlatenRFPeakToPeak | +0.70 | -0.45 |
| ForeLinePressure | -0.58 | +0.67 |
| moriInnerCurrent | +0.47 | -0.47 |
| PlatenRFReflectedPower | +0.46 | -0.58 |

Wafers etch shallower as a lot goes on. The chamber's drift shows up in the tool telemetry and lines up with the measured wafers, which is the signal the lot drift detector looks for.

## What the detectors find

`PublicDataDetectionTest` runs the detectors on all 96 wafers and pins the results in this section. Everything here uses the defaults: bands learned from wafers 1 to 3 of each lot, a limit rule of `k = 6` held for 5 samples, and a run-level threshold of 5.

### Choosing the thresholds

The dataset labels no faults, so the only wafers known to be good are the ones the baseline learns from. Each lot's good wafers were therefore scored against a baseline fitted on the other nine lots, and any alarm on them is a false alarm on a wafer the fit never saw.

| Threshold | Limit alarms, good = wafers 1 to 3 | Run-level alarms, good = wafers 1 to 3 | Limit alarms, good = wafers 2 to 4 | Limit alarms, good = wafers 1 to 2 | Run-level alarms, good = wafers 1 to 2 |
|---:|---:|---:|---:|---:|---:|
| 3 | 23 of 30 | 11 of 30 | 20 of 30 | 14 of 20 | 6 of 20 |
| 4 | 10 of 30 | 3 of 30 | 11 of 30 | 7 of 20 | 1 of 20 |
| 5 | 4 of 30 | 0 of 30 | 4 of 30 | 2 of 20 | 0 of 20 |
| 6 | 2 of 30 | 0 of 30 | 2 of 30 | 2 of 20 | 0 of 20 |
| 7 | 1 of 30 | 0 of 30 | 2 of 30 | 1 of 20 | 0 of 20 |
| 8 | 1 of 30 | 0 of 30 | 2 of 30 | 1 of 20 | 0 of 20 |

The tool channels are smooth. A wafer that reads 3 standard deviations high tends to stay there for seconds, so requiring 5 samples in a row barely helps at `k = 3`. The defaults are the smallest whole thresholds at which fewer than 10 percent of the held-out good wafers alarm. The two that still alarm at `k = 6` are both the first wafer after a clean: lot 2 wafer 1 on PlatenRFLoadCapacitor at 6.8, and lot 9 wafer 1 on PlatenRFTuningCapacitor at 10.2. Taking wafers 2 to 4 as the good runs does not help, because by wafer 4 the match capacitors have already moved in lots 6 and 7.

Taking only wafers 1 to 2, the two closest to the clean, does not help either. The same two wafers alarm at `k = 6`, now 2 of 20, and the price shows when every wafer is scored against a baseline of 20 good runs instead of 30: the summary bands are tighter, the tuning capacitor's ordinary rise along a lot becomes a run-level deviation in every lot, and 49 of the 96 wafers are flagged (36 by the limit detector, 45 at run level, PlatenRFTuningCapacitor first in 47), against 15 with three good wafers per lot. Three stays the default.

A threshold on single samples would not work at all. All 30 held-out good wafers have some sample more than 8 standard deviations out. Most sit at phase edges: Gas5Flow reads almost exactly 0 early in a C4F8 phase, so one sample where the SF6 flow is still falling can score in the thousands.

### The stuck rule

A sensor that stops updating repeats one value, which a band detector cannot see while that value stays inside the band. The stuck rule is learned from the good runs like the bands are: for every channel, the baseline keeps the longest run of one identical value any good run showed inside the etch, and a run is flagged when a channel holds one value for more than a factor times that, and for at least 10 samples. Consecutive recorded samples count, across phase boundaries, and a recording gap ends a hold. The factor was chosen the same way as the limit threshold, on the good wafers scored against a baseline fitted without their own lot:

| Factor | Held-out good wafers with a hold past it |
|---:|---:|
| 1.0 | 7 of 30 |
| 1.25 | 3 of 30 |
| 1.5 | 1 of 30 |
| 2.0 | 0 of 30 |
| 3.0 | 0 of 30 |

The defaults are a factor of 2 and 10 samples. The wafer that still alarms at 1.5 holds Heater2Temp for 1,115 samples where the other lots' good wafers hold it for 611, which is a temperature controller at its setpoint, not a fault. The longest good-run holds say what the rule can see: the heater and the source RF tuning channels hold one value for minutes (Heater3Temp 2,036 samples, SourceRFTuningCapacitor the whole etch), so a stuck reading there is invisible, while the RF and pressure channels move within a second or two (SourceRFPeakToPeak 3 samples, PlatenRFLoadCapacitor 3, Pressure 8, ForeLinePressure 8, HeliumBPPressure 9), so a hold of 2.0 to 3.8 s on them is a flag.

On the public data the rule flags two wafers, lot 6 wafers 6 and 10, both on PlatenRFLoadCapacitor, held for 22 and 12 samples where no good run holds it past 3: the match network stopped moving, on the wafers the limit detector already flags on the same channel. `PublicDataDetectionTest` pins the held-out count at the defaults and those two wafers.

### Flagged wafers

15 of the 96 wafers are flagged, all by the limit detector and all on the two platen match capacitors, PlatenRFLoadCapacitor and PlatenRFTuningCapacitor; two of them, lot 6 wafers 6 and 10, also by the stuck rule on the load capacitor. No wafer has a run-level deviation, and none of the 30 good wafers is flagged.

| Lot | Flagged wafers | Cycle of the first excursion | Largest persistent z |
|---|---|---|---:|
| 6 | 4 to 10 | 85 on wafer 4, down to 28 on wafer 10 | 24.9, wafer 6 |
| 7 | 4 to 6 | 77, 56, 39 | 15.2, wafer 4 |
| 8 | 7 | 88 | 9.6 |
| 9 | 7 to 10 | 83, 74, 30, 34 | 24.8, wafer 10 |

Once the capacitors leave the band they leave it again in most later cycles, and the later the wafer, the earlier in the etch that starts. No other wafer reaches a persistent z of 6. The highest is 5.5, on lot 2 wafer 1.

The one irregular cycle, cycle 74 of lot 3 wafer 7, knocks the chamber pressure far out of band for a moment, with a peak z of 24. Over 5 samples in a row it holds only 4.3, so the limit rule does not flag it. The aligner already reports that cycle as irregular.

### Flags and measured depth

A flag says the tool behaved differently. It does not say the wafer came out worse. Take each wafer's depth loss as its mean depth subtracted from the mean of its lot's wafers 1 to 3. On the 89-point file, the 14 flagged wafers lost 0.60 µm on average, and the 44 unflagged wafers from position 4 on lost 0.64 µm. At each position from 4 to 10, flagged wafers lost about as much as unflagged wafers at the same position, or less. The 9-point file agrees, at 0.57 against 0.63 µm.

So the match capacitors did something in lots 6 to 9 that the first wafers never showed, and the etch depth did not follow it. The drift that does follow depth is the slow rise of PlatenRFTuningCapacitor's SF6 mean, which correlates at -0.80 with depth within lots. By the last wafer, the fitted line is outside the good-run band in every lot. These channels leave the band or are projected to:

| Channel | Outside the band by the last wafer | Projected to leave it within 10 wafers |
|---|---|---|
| PlatenRFTuningCapacitor | all 10 lots | |
| PlatenRFPeakToPeak | lots 3, 6 and 9 | lot 7 |
| PlatenRFReflectedPower | lots 4, 6 and 10 | |
| SourceRFLoadPower | lot 6 | lot 7 |

### Which reference the drift detector uses

The band above is centered on the good runs of every lot. Conditioning could have shifted a lot's level so far that its first wafers already sit outside that band, and the drift detector would call the lot out of band from wafer 4 without any trend. Measured on the current public baseline, phase SF6, that never happens: the mean of each lot's first three wafers is within 3 standard deviations of the good-run mean on every one of the 26 channels with a band, the largest offset being 2.3 (HeliumBPFlow, then Heater2Temp at 2.1), and no channel of any lot is out of band as early as wafer 4. So the global band stays the default.

`GET /api/lots/{lotId}/drift?reference=LOT` centers each channel's band on the mean of the lot's own first three wafers instead, keeping the good runs' spread. It answers a different question, whether the lot has moved from where it started, and on the public data the two references differ on three channels. As of each lot's last wafer:

| Channel | Global band: out, projected to leave | Lot's own start: out, projected to leave |
|---|---|---|
| PlatenRFTuningCapacitor | all 10 lots | all 10 lots |
| PlatenRFPeakToPeak | lots 3, 6 and 9, lot 7 | lot 6, lot 7 |
| PlatenRFReflectedPower | lots 4, 6 and 10 | lots 1, 2, 4, 8 and 10 |
| SourceRFLoadPower | lot 6, lot 7 | lots 5 and 6, lot 7 |

The tuning capacitor's rise is drift under either reference. PlatenRFPeakToPeak in lots 3 and 9 started high and did not move much, so it leaves the global band and not its own; PlatenRFReflectedPower in lots 1, 2 and 8 started inside the global band and moved, so it leaves its own start and not the global band. The other 22 channels are inside both bands in every lot.
