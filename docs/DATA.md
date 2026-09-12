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

Every wafer ran the same recipe: a 1 s ignition, then 100 cycles of 4.5 s of SF6 etching and 1.5 s of C4F8 passivation. The wafers are 200 mm silicon with a 1 µm oxide mask.

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

- Sampling is 5 Hz: 0.2 s steps with 0.01 s of jitter.
- Each wafer has 3,193 to 3,835 samples. In total there are 313,169 sample times and 10,132,286 values.
- Lot 1 has 44 channels and lots 2 to 10 have 31. The 13 channels that only lot 1 has are all constant: Gas6Flow, Heater5Temp to Heater8Temp, SourceRFLoadCapacitor, SourceRF2LoadCapacitor, ThermoCouple1Temp to ThermoCouple4Temp, attenuatorRatio and moriOuterCurrent.
- Gas3Flow, Gas8Flow, SourceRF2LoadPower and SourceRF2ReflectedPower are constant in every wafer. EpdIntensity is constant in 86 of the 96. Heater1Temp stays at 1371.
- 70 of the 96 wafers have one gap in the record, 41 to 45 s long, starting 639 to 670 s after the first sample.
- The dataset does not state units for the channels.

### Recipe position

The file has no step or cycle column, so ChamberWatch derives the recipe position from the gas flows.

- Gas5Flow near 600 marks an SF6 phase, 4.2 to 4.4 s long at 5 Hz.
- Gas4Flow near 300 marks a C4F8 phase, 1.2 to 1.4 s long.
- Every wafer has exactly 100 C4F8 phases and 100 to 102 SF6 segments. The extra SF6 segments are short steps before the etch.
- The etch starts 18 to 147 s into the record and lasts 600 to 631 s.

The dataset does not label its gas lines. Gas5 as SF6 and Gas4 as C4F8 is an inference from the flows and the duty cycle, which match the recipe.

Channels jump between phases, so two wafers compared at the same clock time are often in different steps:

| Channel | SF6 phase | C4F8 phase |
|---|---|---|
| PlatenRFLoadPower | about 79 for the first second, then about 29 | about 39 |
| SourceRFReflectedPower | 35 to 60 | 400 to 480 |
| ForeLinePressure | about 150 | about 80 |
| Pressure | about 0.040 | about 0.050 |

Before the etch, the tool runs Gas1Flow at 150 and Gas4Flow at 300, brings the helium backside pressure up to 15, and strikes the source plasma for about a second. During the strike SourceRFReflectedPower reads 1000, its highest value anywhere in the file.

## Wafer measurements

All lengths are in micrometres, including the X and Y coordinates.

`Si_Oxide_etch_9_points.csv` was measured on the day of each lot at 9 locations on a 19 mm grid: B6, D4, D8, F2, F6, F10, H4, H8 and J6. Its columns are experiment_key, lot_number, wafer_number, loc_id, X, Y, preox_thickness, postox_thickness, stepheight, oxide_etch and si_etch.

The last 9 rows of that file have no experiment_key, lot or wafer. Comparing their pre-etch oxide readings with the 89-point file does not identify a wafer, because the same comparison cannot tell two known wafers apart either. ChamberWatch skips those rows.

`Si_Oxide_etch_89_points.csv` was measured again in February 2025, with different instruments, at 89 locations. Its columns are experiment_key, lot_number, wafer_number, X, Y, preox_thickness, postox_thickness, postox_thickness_nan, stepheight, oxide_etch and si_etch. Per the Readme, the pre-etch oxide was interpolated from 15 measured points. Where the post-etch oxide reading failed, `postox_thickness_nan` is blank, 157 cells in all, and `postox_thickness` holds an interpolated value.

`experiment_key` is `YYYY-MM-DD_NN`, the lot date and the wafer number. It matches the telemetry group `Day_YYYY_MM_DD_Wafer_NN`.

### Two formulas for etch depth

The files compute `si_etch` differently, and each formula holds for every row of its file:

- 9-point file: `si_etch = stepheight - oxide_etch`
- 89-point file: `si_etch = stepheight - postox_thickness`

A step height taken with the mask still in place spans the remaining oxide plus the etched silicon, so ChamberWatch computes depth as `stepheight - postox_thickness` for both files and keeps the raw columns. On the 9-point file that reads 0.235 µm deeper than the file's own `si_etch`, on average. The Readme does not give either formula.

The two files still disagree by about 3 µm on mean depth, because the instruments, the locations and the measurement dates differ. ChamberWatch never mixes the two in one chart.

## What the telemetry shows

This is a first look, not a result. The correlations below are within lots: each lot's mean was removed first, so differences between lots do not count. Channel values are per-wafer means over the SF6 phases, and depth is the per-wafer mean of the 89-point file.

| Measure | Against position in the lot | Against measured depth |
|---|---:|---:|
| Measured depth | -0.85 | |
| PlatenRFTuningCapacitor | +0.90 | -0.80 |
| PlatenRFPeakToPeak | +0.70 | -0.45 |
| ForeLinePressure | -0.58 | +0.67 |
| moriInnerCurrent | +0.47 | -0.47 |
| PlatenRFReflectedPower | +0.46 | -0.58 |

Wafers etch shallower as a lot goes on. The chamber's drift shows up in the tool telemetry and lines up with the measured wafers, which is the signal the lot drift detector looks for.
