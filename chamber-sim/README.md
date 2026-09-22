# chamber-sim

A plasma etch chamber, in C11 with no dependencies, that streams what it is doing over TCP.

ChamberWatch reads wafers that were etched a year ago. This program etches one now: it walks the recipe a step at
a time, keeps the chamber's hidden state, and writes what the 31 channels read every 0.2 s as a line of JSON. The
other end of the socket can put a fault into the run and watch the detectors catch it.

```
make
build/chamber-sim --seed=7 --lot=1 --wafer=3
```

```
{"type":"hello","protocol":1,"seed":7,"lot":1,"wafer":3,"run":"LIVE-s7-L1-W03","period_s":0.2,"channels":["EpdIntensity",...]}
{"type":"sample","tick":1,"t":0.200,"state":"IDLE","cycle":0,"v":[0.1230,23.8040,...]}
...
{"type":"end","reason":"COMPLETE","samples":3436,"fault":{"kind":"GAS_FLOW_STUCK_LOW","channel":"Gas5Flow","start_s":200.000,"duration_s":null,"magnitude":0.3600}}
```

## What it models

The recipe is a state machine: idle, an 11.8 s stabilization step, a low-power strike, a settle, then 100 cycles
that alternate an SF6 phase of about 4.4 s with a C4F8 phase of about 1.4 s, and an end that runs the last SF6
phase long and leaves the gas on a second after the plasma stops. The lengths are drawn from the seed, inside the
windows the public wafers show, so a seed decides the whole run before the first tick.

Nothing writes a reading directly. The recipe sets flows; the mass flow controllers answer the way the public ones
do, covering about 93% of a new setpoint in the first 0.2 s sample and holding it to a few thousandths of a sccm
from the third, so the first slot of a phase is the only wide one; the throttle valve holds the chamber at its
setpoint while the foreline pressure follows the gas load at the 0.21 per sccm the public wafers show; the match networks chase the plasma; the walls condition as it burns, and
the platen capacitors walk with them. The 31 channels are views of that state, read through sensors that add this
wafer's own offset, a slow wander and the channel's noise.

Every number in the channel table was measured on the public wafers rather than chosen: the idle levels from the
template the Java simulator built, the phase levels from a public wafer's phase means, the noise from the median
step between consecutive samples inside the etch, and the spread between wafers from how far one wafer's phase mean
sits from another's. The heaters drift slower than the 0.1 degree they are reported in, and their drift is set so
the reported value holds as long on average as the public heaters' does. What is **not** calibrated is how often a fault of a
given size is caught: [docs/EVALUATION.md](../docs/EVALUATION.md)'s recall numbers belong to the Java simulator,
which was fitted to the public alarm rates. A fault streamed from here is caught on its own merits.

That is why a fault attaches where the trouble starts rather than to a reading. A stuck mass flow controller
delivers a share of what it was told, and the foreline pressure falls with the missing gas **by itself**. The
knock-on is the chamber's, not the fault's.

Interlocks refuse a step whose preconditions are not met, rather than letting the chamber into a state it could
not reach: no strike without process gas, none onto an unclamped wafer, no second strike while the plasma burns,
nothing at all after the run ends. A refusal is answered on the wire and the run is left where it stood.

## Watching ChamberWatch catch it

A baseline has to be learned before anything can be judged against it, and a live one learns the way the public
one does: from the first three wafers of every lot. So the demo streams wafers 1 to 3 of ten lots first, the 30
good runs the public baseline has, and then a wafer with a fault. `frontend/e2e/record-live.mjs` does exactly that
and films the last one, which is how `docs/images/live.gif` was made.

Measured here, with those 30 wafers learned:

- **Clean wafers:** wafer 4 of each of the ten lots, streamed clean, drew no flag in 9 of 10, scoring 2.0 to 4.0
  against a limit of 6. The tenth drew a stuck flag on Heater 3. Heaters move slower than the 0.1 degree they are
  reported in, so they hold one value for long stretches, and the model's longest holds are not calibrated the way
  its average hold is. The same rule raised 0 alarms on 30 held-out public wafers.
- **Faulted wafers:** 12 wafers, each given a seeded random fault, were all flagged, 11 with the faulty channel named
  first. The exception was a stuck SF6 flow whose foreline pressure departed in the same 0.2 s slot and won the
  tie, which is the knock-on this model is built to produce. Stuck flows, dropouts and stuck sensors were named
  within about a second of the fault; a slow rise in reflected power took up to 13 s, or only showed at run level.

Fewer good runs are not enough. With three, the bands come out as narrow as three wafers happen to agree, and a
fourth that differs by an ordinary amount is flagged. That is how this README first described the demo, and
streaming a real lot through it is how that was found.

## Determinism

The same seed, lot and wafer give the same run on any machine. The generator is SplitMix64 with a separate stream
per purpose, so adding a draw to the chamber never moves the numbers the recipe or the faults draw; the normal is
twelve uniforms less six, so the random draws call no libm function whose rounding could differ between platforms
(the one libm call left, `floor` when a reading is rounded to the tool's resolution, is exact); and a run's commands
are the only other input, so replaying them replays the run.

## Talking to it

Commands are one JSON object per line, on the same connection:

```
{"cmd":"inject","kind":"GAS_FLOW_STUCK_LOW","channel":"Gas5Flow","start_s":312.4,"duration_s":null,"magnitude":0.36}
{"cmd":"status"}
{"cmd":"abort"}
```

Each one gets exactly one ack, interleaved between the samples, and a refusal says what refused it:

```
{"type":"ack","cmd":"inject","tick":1560,"accepted":true}
{"type":"ack","cmd":"start","tick":0,"accepted":false,"refused":"IL_NO_HELIUM_BACKSIDE","detail":"HeliumBPPressure 3.2 below 12"}
```

The fault kinds are the five the Java simulator uses, so a live run is scored by the same rules as a stored one:
`GAS_FLOW_STUCK_LOW`, `PRESSURE_SPIKE`, `REFLECTED_POWER_RISE`, `SENSOR_DROPOUT`, `SENSOR_STUCK`.

| Option | Meaning |
|---|---|
| `--seed=N` | the run's seed, which decides it completely (default 7) |
| `--lot=N`, `--wafer=N` | which wafer of which lot is being etched (default 1, 1) |
| `--port=N` | the port to listen on; 0 takes any and prints it (default 5610) |
| `--host=ADDR` | the address to bind (default 127.0.0.1) |
| `--rate=N` | N times real time; 0 runs with no waiting, which is how a test drives it (default 1) |
| `--fault=random` | put a seeded fault into the run, drawn from the kinds and sizes the public wafers suggest |

One connection at a time: this is one chamber.

## Building and testing

```
make            # build/chamber-sim
make test       # the unit tests, about 21,000 checks
make SAN=1 test # the same under the address and undefined-behaviour sanitizers
make smoke      # run one wafer through the real binary over a socket and check the frames
```

`-Wall -Wextra -Werror` throughout. The tests drive the model directly; the smoke test drives the program, and
needs python3 as its client. On Windows the Makefile links winsock; everywhere else it needs nothing.
