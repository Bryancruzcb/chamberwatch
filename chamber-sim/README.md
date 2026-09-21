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

Nothing writes a reading directly. The recipe sets flows; the mass flow controllers take time to reach them; the
throttle valve holds the chamber at its setpoint while the foreline pressure follows the gas load at the
0.21 per sccm the public wafers show; the match networks chase the plasma; the walls condition as it burns, and
the platen capacitors walk with them. The 31 channels are views of that state, read through sensors that add this
wafer's own offset, a slow wander and the channel's noise.

Every number in the channel table was measured on the public wafers rather than chosen: the idle levels from the
template the Java simulator built, the phase levels from a public wafer's phase means, and the noise from the
median step between consecutive samples inside the etch. What is **not** calibrated is how often a fault of a
given size is caught: [docs/EVALUATION.md](../docs/EVALUATION.md)'s recall numbers belong to the Java simulator,
which was fitted to the public alarm rates. A fault streamed from here is caught on its own merits.

That is why a fault attaches where the trouble starts rather than to a reading. A stuck mass flow controller
delivers a share of what it was told, and the foreline pressure falls with the missing gas **by itself**. The
knock-on is the chamber's, not the fault's.

Interlocks refuse a step whose preconditions are not met, rather than letting the chamber into a state it could
not reach: no strike without process gas, none onto an unclamped wafer, no second strike while the plasma burns,
nothing at all after the run ends. A refusal is answered on the wire and the run is left where it stood.

## Watching ChamberWatch catch it

A baseline has to be learned before anything can be judged against it, so the demo is four wafers: stream three
clean ones, then one with a fault.

```sh
# three clean wafers, then one with a fault; the Live page starts each recording, or curl does
for wafer in 1 2 3 4; do
  fault=$([ $wafer = 4 ] && echo --fault=random)
  build/chamber-sim --port=5610 --rate=50 --lot=1 --wafer=$wafer $fault &
  sleep 1
  curl -sXPOST localhost:8080/api/live/start -H 'Content-Type: application/json'     -d '{"host":"127.0.0.1","port":5610}'
  wait
done
```

Measured here on a lot streamed that way: the three clean wafers score 2.5 to 3.0 against their own bands and are
flagged by nothing, and the faulted one, a sensor dropout at 415.6 s, is flagged with `HeliumBPPressure` named
first at 415.4 s. A starved SF6 flow is caught the same way, with the foreline pressure ranked second behind it
because the model drags it down.

The wafer streamed first cannot be judged: it is the only good run its baseline has, so it is scored against
itself and nothing can depart from anything.

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
