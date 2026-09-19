# Evaluation

The public data labels no faults, so ChamberWatch scores its detectors on simulated wafers with known ones. This page covers how the simulator is built from the public wafers, how it was checked against them, and what the committed evaluation measures. The numbers live in [results/metrics.json](../results/metrics.json), and `EvaluationRegressionTest` recomputes them in CI.

## The simulator

`Simulator.run(RunSpec)` makes one `RawRun` of the 31 channels all public lots record, so the aligner and the detectors cannot tell it from a real wafer. A seed, a lot number and a wafer position decide a run completely. Every draw uses integer arithmetic or `StrictMath`, so a seed gives the same bits on Windows and Linux.

A run follows the structure [DATA.md](DATA.md) describes. It starts idle, runs the 11.8 s stabilization step and a short strike step, then starts the etch in one of the three public ways, in the public proportions of 65, 10 and 21 of 96. The etch has 99 C4F8 phases, or 98 in 3 of 96 runs, and ends with an SF6 phase whose gas outlasts the plasma. Samples come at 5 Hz with 0.01 s of jitter. The source power dips for a single sample in 56 of 96 runs, and 69 of 96 records have a 41 to 45 s gap after the etch. The marker channels switch cleanly between their phase levels, as they do in every public wafer.

Every other reading during the etch is a sum of parts measured on the public wafers, then clamped at 0 on channels that never read below it and rounded to the channel's resolution:

| Part | What it is | Measured on |
|---|---|---|
| Profile | The phase's average shape, slot by slot | good runs |
| Trend | How far each cycle's level sits from its run's level | good runs |
| Lot level | One normal draw per lot, with the measured spread of lot levels | all 96 wafers |
| Drift | How far runs sit from their lot's first three wafers, by wafer position, averaged over the lots, and scaled once per lot | all 96 wafers |
| Run level | One draw per wafer around its lot's level and drift | all 96 wafers |
| Wander | Slow correlated movement from cycle to cycle | good runs |
| Noise | Fast correlated movement from sample to sample | good runs |
| Swings | A few cycles far from the run's level, copied from the ones good runs showed on the same channel | good runs |

`TemplateBuilder` does the measuring, and the `sim-template` command writes the result to `backend/src/main/resources/sim/template.tsv`. Wherever the data is downloaded, `PublicDataTemplateTest` rebuilds the template and checks that it matches the committed file.

Two measuring choices matter. A cycle's level is the median distance of its readings from the phase's shape, so a one-sample dip in a gas flow cannot move a whole cycle. The noise is the trimmed spread of a typical offset, so the few offsets where a step lands a sample early do not set it. With each cycle's mean and a clipped root mean square instead, the simulated Gas5Flow band came out 7 times wider than the public one. With these choices, a simulated baseline's median band width comes within 20 percent of the public baseline's on 21 of the 24 channels compared. The platen load capacitor's band is 60 percent wider, Heater4Temp's is 30 percent narrower, and Gas5Flow's is 23 percent narrower. `SimulatorCalibrationTest` writes the full comparison to `target/sim-calibration.txt`.

## Checking it against the public wafers

The public wafers do say how often a good wafer from a lot the fit never saw sets off an alarm ([DATA.md](DATA.md#choosing-the-thresholds)). `SimulatorCalibrationTest` runs the same experiment on simulated wafers four times: fit a baseline on 30 clean training runs, then score wafers 1 to 3 of 50 new lots.

Two settings could not be measured directly, so that comparison chose them.

- Lot levels are normal. A heavy-tailed Student t with 3 degrees of freedom gave 9 run-level alarms per 100 at threshold 5, where the public wafers gave none.
- Swings happen at a tenth of the rate the good runs showed. A swing is measured as a shift of a cycle's median. On the match capacitors, where most swings are, that shift is mostly a change of shape within the phase, which moves single readings less than a real shift would.

| Swing rate factor | Limit alarms per 100 at k = 3, 4, 5, 6, 7, 8 | Run-level alarms per 100 at 3, 4, 5 |
|---|---|---|
| Public wafers | 77, 33, 13, 7, 3, 3 | 37, 10, 0 |
| 0 | 69, 13, 3, 0, 0, 0 | 31, 6, 1 |
| **0.10** | **72, 23, 12, 8, 6, 5** | **32, 9, 2** |
| 0.15 | 73, 27, 16, 11, 9, 8 | 32, 8, 2 |
| 0.20 | 75, 32, 20, 14, 11, 9 | 34, 10, 3 |
| 0.25 | 76, 34, 23, 16, 13, 10 | 34, 10, 4 |
| 0.30 | 77, 38, 25, 19, 14, 11 | 34, 9, 3 |
| 1 | 88, 68, 53, 40, 30, 25 | 33, 8, 1 |

Each simulated row covers 600 wafers. 0.10 comes closest at k = 5 and 6, around the default threshold, and runs 10 per 100 short at k = 4. The table was measured again when the drift became a measured profile, and the choice held. The public row comes from 30 wafers, so each of its rates has a sampling error of up to 9 per 100. The test fails if the simulated rates leave the public ones by more than 10 per 100 at thresholds 3 to 5, or 5 per 100 above.

## The faults

| Kind | Channels | Size | How it changes readings |
|---|---|---|---|
| Gas flow stuck low | Gas4Flow, Gas5Flow | 30 to 95 % of the flow | from its start to the end of the etch, and the foreline pressure falls with the missing flow |
| Pressure spike | Pressure | 1 to 10 % of the SF6 pressure, for 1 to 6 s | adds that much while it lasts |
| Reflected power rise | SourceRFReflectedPower | 5 to 60 W | ramps up over 10 to 60 s, then holds to the end of the etch |
| Sensor dropout | ForeLinePressure, HeliumBPPressure, SourceRFPeakToPeak | 1 to 20 s | reads 0 while it lasts |
| Sensor stuck | ForeLinePressure, HeliumBPPressure, SourceRFPeakToPeak | 1 to 20 s | repeats the last reading while it lasts |

The size ranges reach down to faults near the limit, so recall has room to fall below 1. A gas stuck below half its flow also hides its phase marker, so the aligner predicts those onsets and marks the run degraded. A stuck sensor holds a reading that was in band when it froze, so the limit detector sees it only when the hold carries one phase's reading into the other phase. The stuck rule needs the hold to outlast the longest hold the good runs showed on that channel by the rule's factor and at least 2 s ([DATA.md](DATA.md#the-stuck-rule)), so the shortest stuck faults can be missed by design.

Channels do not affect each other, with one exception. A gas flow stuck low takes ForeLinePressure down with it: 0.21 per missing sccm, spread over three samples as 27 %, 52 % and 21 %, both read from the public wafers ([DATA.md](DATA.md#what-follows-the-gas-flow)). The factor is measured for SF6 and assumed for C4F8, whose phase is too short to settle. The chamber pressure is left alone, because the public wafers show the tool holding it at a setpoint whatever the flow. The knock-on draws no random numbers, so it changes no other run.

## The committed evaluation

`Evaluation.run(EvaluationConfig.defaults(), SimulationTemplate.bundled())` fits a baseline on clean wafers 1 to 3 of 10 training lots, then simulates 100 test lots of 10 wafers. The seed picks 125 of the 1,000 test runs to carry one fault each, 25 of each of the five kinds, starting in a random cycle from 5 to 90. Each run is simulated, aligned, scored and dropped, and the whole evaluation takes about 20 s.

A fault counts as caught when its channel has an excursion, or for a stuck sensor a hold, confirmed after the fault starts that begins no later than one cycle after it ends. The latency runs from the fault's start to the earliest such confirmation. `FaultSignature` names the fault a run looks like, from the first departure in rank order that fits a pattern: a gas flow reading low, the pressure or the reflected source power reading high, a dropout channel reading exactly 0, or a sensor channel holding one value. Precision for a kind is the share of runs with that signature that really had that fault.

| Fault | Recall | Precision | Median latency | Caught faults ranked first |
|---|---:|---:|---:|---:|
| Gas flow stuck low | 1.00 | 1.00 | 1.9 s | 100 % |
| Pressure spike | 0.76 | 1.00 | 2.0 s | 89 % |
| Reflected power rise | 0.68 | 1.00 | 20.8 s | 100 % |
| Sensor dropout | 1.00 | 1.00 | 0.9 s | 92 % |
| Sensor stuck | 0.96 | 1.00 | 1.8 s | 96 % |

The metrics file has been rewritten on purpose twice since the four-kind table. Adding the fifth kind redrew the whole schedule, so the runs, sizes and start cycles behind every row changed, and the pressure spike and reflected power rows moved from 0.88 to 0.76 and 0.72 on 25 faults each, a draw whose sampling error is about 0.08. Then the drift along a lot became the measured profile instead of a straight line (see the late wafers below): the schedule stayed, but every simulated reading and the baseline moved, which took one more reflected power rise below the band (0.68) and changed which channel left first in a few runs. A stuck flow can only show while its gas is meant to be on, so it can wait out the other phase first. A reflected power rise needs time to climb past the band. A stuck sensor is caught once its hold outlasts the rule's threshold, which on this simulated baseline is 10 samples on SourceRFPeakToPeak, 13 on ForeLinePressure and 15 on HeliumBPPressure (2.0, 2.6 and 3.0 s; the simulated good runs hold at most 3, 6 and 7 samples there), or sooner when the held reading leaves the band at a phase change, which came first in 7 of the 24 caught. All 24 also have a hold that passed the rule. HeliumBPPressure reads the same in both phases, so its 4 stuck faults were caught by the hold alone. The one miss in 25 is a 1.5 s fault on ForeLinePressure, a hold of 9 samples. When a caught fault is not ranked first, another channel had left its band earlier in the run.

The knock-on tests the ranking against a fault's own effect. In 23 of the 25 stuck flows the foreline pressure is flagged as well; the two it misses are C4F8 flows at 92 and 94 % of their setpoint, too small a loss to move the foreline past its band. In all 23 the flow is ranked above the foreline it moved, and the first-channel rate did not move when the knock-on went in. The flow leaves its band one to four slots before the foreline in 16 of them, because the foreline answers over three samples. In the other 7 both leave in the same slot and the tie goes to the larger peak `|z|`, which the flow wins by orders of magnitude, since a mass flow controller's band is a few hundredths of a sccm wide. Ranking by earliest start puts the cause first here, but in those ties it is the tie-break that does it: an effect with a tighter band than its cause would win them. `knockOn.forelineFlaggedRate` and `knockOn.flowRankedAboveRate` in the metrics file pin both numbers.

Of the 875 clean test runs, 8.0 % are flagged: 5.7 % by the limit detector and 2.3 % by the run-level detector, a few by both, and 0.8 % by the stuck rule, 7 runs, all on Gas1Flow, a flow that idles near 0.3 sccm and reads in steps of 0.01, so how long it repeats a value depends on where its level sits between two steps. Among wafers 1 to 3 the rate is 8.9 %, close to the calibration.

Among wafers 4 to 10 it is 7.6 %: 5.8 % by the limit detector and 2.1 % at run level, 13 of 617 wafers. The public late wafers had no run-level deviation in 66, which puts their rate under 4.4 % with 95 % confidence, so 2.1 % is inside the public sampling error. With the straight-line drift it was 16.4 % flagged, most of it run-level deviations on wafers 9 and 10. The flags are now spread evenly along the lot, 10 of the 47 on wafers 9 and 10, and the run-level ones no longer sit on the drifting channels.

After a deliberate change, `./mvnw test -Dtest=EvaluationRegressionTest -Dchamberwatch.writeMetrics=true` rewrites the metrics file. Otherwise CI fails when a rate moves more than 0.02, a latency more than 0.5 s, or a count or setting at all.

## What the simulator leaves out

- **Late wafers' limit flags.** The drift along a lot is the public lots' own: for each channel and phase, how far runs sit from their lot's first three wafers at each position, averaged over the ten lots, with each lot showing a share of that profile drawn around 1 ([DATA.md](DATA.md#how-the-lots-drift)). It used to be a straight line, which kept climbing past the point where the public lots level off and pushed simulated wafers 9 and 10 over the run-level threshold. What is still missing is why the public late wafers are flagged: 15 of 66 by the limit detector, because their match capacitors change shape within the phase, which the simulator does not model. Simulated late wafers get 5.8 % limit flags, from swings. So the run-level rate of late wafers is calibrated and their limit rate is not.
- **Channel coupling.** One knock-on is modeled, a stuck flow lowering the foreline pressure. Every other channel is independent, so a pressure spike or a rising reflected power moves nothing else, and the ranking is tested against one fault's own effects, not all of them.
- **Edges of the record.** Pre-etch and post-etch readings are flat idle levels, and the 13 constant channels only lot 1 records are left out.
- **Fault sizes.** The size ranges are chosen, not measured, since the public data has no faults to measure.
