# ChamberWatch

Tool-health monitoring for a plasma etch tool. ChamberWatch reads each wafer's machine telemetry, learns what a good run looks like at each point in the recipe, and flags runs that go out of range or drift across a lot. For every flag it shows which sensor changed first, next to the measured result on the wafer.

Status: in progress. The aligner places all 96 public wafers on a fixed recipe grid, and the ingest loads their 10.1 million samples into PostgreSQL. The detectors come next. [docs/DESIGN.md](docs/DESIGN.md) describes the whole plan.

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

# Start Postgres on port 55432, then load the public data. A second run reads nothing and adds no rows.
docker compose up -d
java -jar target/chamberwatch.jar ingest --data=../data/public/zenodo17122442 --md5=../docs/zenodo17122442.md5
```

```bash
cd frontend
npm install
npm run dev
```
