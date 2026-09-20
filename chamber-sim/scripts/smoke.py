"""Drives the chamber simulator over TCP and checks the run it streams.

Starts the binary on a port the system picks, connects, reads every frame to the end, injects a stuck gas flow
partway through, and checks the structure the ChamberWatch aligner needs: the markers that separate the phases,
the etch power, about 100 cycles, and an end frame that reports the fault that was injected.
"""
import json
import os
import socket
import subprocess
import sys

TICK_S = 0.2


def fail(message):
    print("smoke: " + message)
    sys.exit(1)


def main(binary):
    process = subprocess.Popen([os.path.abspath(binary), "--port=0", "--rate=0", "--seed=7", "--lot=1",
                                "--wafer=3"],
                               stdout=subprocess.PIPE, text=True)
    listening = json.loads(process.stdout.readline())
    port = listening["port"]
    frames = []
    with socket.create_connection(("127.0.0.1", port), timeout=30) as client:
        client.sendall(b'{"cmd":"inject","kind":"GAS_FLOW_STUCK_LOW","channel":"Gas5Flow","start_s":200.0,'
                       b'"magnitude":0.36}\n')
        rest = ""
        while True:
            chunk = client.recv(65536)
            if not chunk:
                break
            rest += chunk.decode()
            while "\n" in rest:
                line, rest = rest.split("\n", 1)
                if line.strip():
                    frames.append(json.loads(line))
    process.wait(timeout=30)

    hello = frames[0]
    if hello.get("type") != "hello":
        fail("the first frame is not a hello: %r" % hello)
    if len(hello["channels"]) != 31:
        fail("%d channels, expected 31" % len(hello["channels"]))
    if hello["run"] != "LIVE-s7-L1-W03":
        fail("run key %r" % hello["run"])

    samples = [frame for frame in frames if frame["type"] == "sample"]
    acks = [frame for frame in frames if frame["type"] == "ack"]
    end = frames[-1]
    if end["type"] != "end" or end["reason"] != "COMPLETE":
        fail("the run did not finish: %r" % end)
    if not (2700 < len(samples) < 3600):
        fail("%d samples, expected a run of about 3,000" % len(samples))
    if not any(ack["cmd"] == "inject" and ack["accepted"] for ack in acks):
        fail("the injected fault was not accepted: %r" % acks)
    if end.get("fault", {}).get("kind") != "GAS_FLOW_STUCK_LOW":
        fail("the end frame does not report the fault: %r" % end)

    names = hello["channels"]
    gas5 = names.index("Gas5Flow")
    gas4 = names.index("Gas4Flow")
    power = names.index("SourceRFLoadPower")
    sf6 = [frame for frame in samples if frame["state"] == "ETCH_SF6"]
    c4f8 = [frame for frame in samples if frame["state"] == "ETCH_C4F8"]
    if not sf6 or not c4f8:
        fail("the etch has no phases")
    early = [frame for frame in sf6 if frame["t"] < 200.0]
    late = [frame for frame in sf6 if frame["t"] > 260.0]
    if max(frame["v"][gas5] for frame in early) < 300:
        fail("the SF6 marker never rose above 300 before the fault")
    if max(frame["v"][gas4] for frame in c4f8) < 150:
        fail("the C4F8 marker never rose above 150")
    if max(frame["v"][power] for frame in sf6) < 1000:
        fail("the etch never reached its power")
    if late and max(frame["v"][gas5] for frame in late) > 300:
        fail("the stuck flow did not hold the SF6 marker down")
    cycles = max(frame["cycle"] for frame in samples)
    if cycles != 100:
        fail("%d cycles, expected 100" % cycles)

    print("smoke: %d frames, %d samples, %d cycles, fault %s, run %s"
          % (len(frames), len(samples), cycles, end["fault"]["kind"], end["reason"]))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "build/chamber-sim")
