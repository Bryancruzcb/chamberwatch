# ChamberWatch

Tool-health monitoring for a plasma etch tool. ChamberWatch reads each wafer's machine telemetry, learns what a good run looks like at each point in the recipe, and flags runs that go out of range or drift across a lot. For every flag it shows which sensor changed first, next to the measured result on the wafer.

Status: early. The dataset is documented, and the backend and frontend skeletons build and pass CI. The design and the first detectors come next.

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
./mvnw test              # runs the tests against a throwaway Postgres container
./mvnw spring-boot:run   # starts Postgres from compose.yaml, then the service
```

```bash
cd frontend
npm install
npm run dev
```
