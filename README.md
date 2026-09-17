# ChamberWatch

Tool-health monitoring for a plasma etch tool. ChamberWatch reads each wafer's machine telemetry, learns what a good run looks like at each point in the recipe, and flags runs that go out of range or drift across a lot. For every flag it shows which sensor changed first, next to the measured result on the wafer.

Status: in progress. The aligner places all 96 public wafers on a fixed recipe grid, the ingest loads their 10.1 million samples into PostgreSQL, the detectors score every wafer against a baseline learned from the first wafers of each lot, and the ingest stores those scores. A seeded simulator makes wafers with known faults, and CI scores the detectors on 1,000 of them ([results/metrics.json](results/metrics.json), [docs/EVALUATION.md](docs/EVALUATION.md)). An HTTP API serves the runs table, each run's ranked channels and charts, wafer measurements, relabeling, lot drift and a drift-versus-depth report. A React app covers the runs table, each run's trace against the good-run band, each lot's drift channel by channel, each wafer's depth map, and drift against depth by wafer position. A `simulate-lot` command stores a seeded synthetic lot with four known faults next to the clean lots its baseline learns from, with the injected fault kept beside each run; the app switches between the public and the simulated wafers and shows each injected fault next to what the detectors caught. `report` writes the drift-versus-depth report to a file ([results/public-drift.json](results/public-drift.json)). [docs/DESIGN.md](docs/DESIGN.md) describes the whole plan.

## Data

ChamberWatch runs on a public plasma etch dataset: 96 wafers in 10 lots, 31 tool channels sampled 5 times a second, and etch depth measured on each wafer. [docs/DATA.md](docs/DATA.md) covers the source, the download, and the quirks the code handles. The data files are not in this repository.

## Layout

| Path | Contents |
|---|---|
| `backend/` | Java 21, Spring Boot 4.1, PostgreSQL with Flyway migrations |
| `frontend/` | React, TypeScript, Vite |
| `docs/` | Notes on the data and the design |

## Running it locally

You need JDK 21, Node 22.12 or newer, and Docker.

```bash
cd backend
./mvnw test                    # unit tests, plus database tests against a throwaway Postgres container
./mvnw package -DskipTests

# Align the public wafers and print one line per wafer. Needs no database.
java -jar target/chamberwatch.jar align --data=../data/public/zenodo17122442 --md5=../docs/zenodo17122442.md5

# Start Postgres on port 55432, then load the public data, fit a baseline and score every wafer.
# A second run reads nothing, reuses the baseline and adds no rows.
docker compose up -d
java -jar target/chamberwatch.jar ingest --data=../data/public/zenodo17122442 --md5=../docs/zenodo17122442.md5

# Store a seeded synthetic lot with four known faults, plus the clean training lots its baseline learns from. A rerun adds nothing.
java -jar target/chamberwatch.jar simulate-lot --seed=7 --lot=901

# Write the drift-versus-depth report for the public data next to the metrics file.
java -jar target/chamberwatch.jar report --out=../results/public-drift.json

# Serve the API on port 8080, with the OpenAPI description at /v3/api-docs. Add --server.port=18080 if 8080 is taken.
java -jar target/chamberwatch.jar

# Score the detectors on 1,000 simulated wafers and compare with results/metrics.json. Needs no data and no database.
./mvnw test -Dtest=EvaluationRegressionTest

# Measure the simulator's template from the public wafers again, over the committed one.
java -jar target/chamberwatch.jar sim-template --data=../data/public/zenodo17122442 --md5=../docs/zenodo17122442.md5
```

```bash
cd frontend
npm install
npm run dev     # http://localhost:5173, passing /api to the backend on port 8080
npm test        # unit tests
npm run e2e     # build, then drive the built app in Chromium against API responses captured from the public data
```

If the backend runs on another port, point the dev server at it with `CHAMBERWATCH_API=http://localhost:18080 npm run dev`.
