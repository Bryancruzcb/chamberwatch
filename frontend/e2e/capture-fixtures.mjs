// Captures every e2e fixture from a running API, byte for byte, so none is ever written by hand.
//
//   node e2e/capture-fixtures.mjs [http://localhost:18080]
//
// The database behind the API must hold the public wafers and the simulated lot 901 of seed 7
// (`ingest`, then `simulate-lot --seed=7 --lot=901`). Runs and lots are found by key and lot number, the files
// are named by the ids the API gave them, and fixtures of ids that no longer exist are removed. The ids are
// printed at the end: the specs and `src/api/fixtures.test.ts` name them, so check them after a rebuild.
import { readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const API = (process.argv[2] ?? process.env.CHAMBERWATCH_API ?? 'http://localhost:18080').replace(/\/$/, '')
const FIXTURES = join(import.meta.dirname, 'fixtures')
const MAX_POINTS = 1200

const FLAGGED_WAFER = 'Day_2024_08_01_Wafer_05'
const GOOD_WAFER = 'Day_2024_07_05_Wafer_01'
const STUCK_FLOW_WAFER = 'SIM-s7-L901-W07'
const STUCK_SENSOR_WAFER = 'SIM-s7-L901-W10'

const written = new Set()

async function capture(name, path) {
  const response = await fetch(API + path, { headers: { Accept: 'application/json' } })
  if (!response.ok) {
    throw new Error(`${path} answered ${response.status}`)
  }
  const text = await response.text()
  writeFileSync(join(FIXTURES, name), text)
  written.add(name)
  return JSON.parse(text)
}

function runId(page, key) {
  const run = page.runs.find((row) => row.key === key)
  if (run === undefined) {
    throw new Error(`the API has no run ${key}`)
  }
  return run.id
}

function lotId(lots, source, lotNo) {
  const lot = lots.find((row) => row.source === source && row.lotNo === lotNo)
  if (lot === undefined) {
    throw new Error(`the API has no ${source} lot ${lotNo}`)
  }
  return lot.id
}

const lots = await capture('lots.json', '/api/lots')
const runs = await capture('runs.json', '/api/runs')
const simulated = await capture('runs-synthetic.json', '/api/runs?source=SYNTHETIC')
await capture('drift-vs-depth.json', '/api/reports/drift-vs-depth')
await capture('drift-vs-depth-synthetic.json', '/api/reports/drift-vs-depth?source=SYNTHETIC')

const flagged = runId(runs, FLAGGED_WAFER)
const good = runId(runs, GOOD_WAFER)
const stuckFlow = runId(simulated, STUCK_FLOW_WAFER)
const stuckSensor = runId(simulated, STUCK_SENSOR_WAFER)
const publicLot = lotId(lots, 'PUBLIC', 6)
const simulatedLot = lotId(lots, 'SYNTHETIC', 901)

for (const id of [flagged, good, stuckFlow, stuckSensor]) {
  await capture(`run-${id}.json`, `/api/runs/${id}`)
}
const traces = [[flagged, 'PlatenRFLoadCapacitor'], [stuckFlow, 'Gas5Flow'], [stuckSensor, 'HeliumBPPressure']]
for (const [id, channel] of traces) {
  // the view a run page opens on: the etch, cycles 1 to 100
  await capture(`trace-${id}.json`, `/api/runs/${id}/channels/${channel}/trace?maxPoints=${MAX_POINTS}&fromCycle=1&toCycle=100`)
}
await capture(`measurements-${flagged}.json`, `/api/runs/${flagged}/measurements?set=EIGHTY_NINE_POINT`)
await capture(`measurements-${flagged}-nine.json`, `/api/runs/${flagged}/measurements?set=NINE_POINT`)
for (const id of [publicLot, simulatedLot]) {
  await capture(`drift-${id}.json`, `/api/lots/${id}/drift`)
}

for (const name of readdirSync(FIXTURES)) {
  if (name.endsWith('.json') && !written.has(name)) {
    rmSync(join(FIXTURES, name))
    console.log(`removed ${name}`)
  }
}
console.log(`captured ${written.size} fixtures from ${API}`)
console.log(JSON.stringify({ flagged, good, stuckFlow, stuckSensor, publicLot, simulatedLot }))
