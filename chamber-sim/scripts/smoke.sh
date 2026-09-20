#!/bin/sh
# Runs one wafer through the real binary and checks the frames it produced.
#
# The unit tests drive the model directly; this drives the program: it starts it on a port of the system's
# choosing, connects, reads every frame, injects a fault on the way, and checks that what came back is a run the
# aligner would recognise. Needs python3 only as the client.
set -e
cd "$(dirname "$0")/.."
BINARY=build/chamber-sim
[ -f build/chamber-sim.exe ] && BINARY=build/chamber-sim.exe
python3 scripts/smoke.py "$BINARY"
