// Records docs/images/live.gif: the Live page watching the C chamber simulator etch a wafer with a fault in it, and
// the run page naming what the detectors caught.
//
//   node e2e/record-live.mjs [app url] [simulator binary]
//
// It needs ChamberWatch serving the web app with a writable API at the URL, by default the preview server on 4173
// passing /api to a backend (`CHAMBERWATCH_API=http://localhost:18080 npx vite preview`), and the simulator built
// (`make` in chamber-sim). A live baseline has to be learned before anything can be judged against it, and it
// learns the way the public one does, from the first three wafers of ten lots, so the script first streams those 30
// clean wafers, off camera, as fast as the simulator runs; a wafer already stored is found rather than stored again.
// Then it films wafer 4 of LOT, 19 by default, whose seeded fault is an SF6 flow stuck at a third of its setpoint
// from 170 s. The video goes through ffmpeg into a GIF.
//
// Every run it streams is stored, like any live run, so the filmed wafer must not have been streamed before.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from '@playwright/test'

const APP = (process.argv[2] ?? 'http://localhost:4173').replace(/\/$/, '')
const BINARY = resolve(process.argv[3] ?? defaultBinary())
const OUT = resolve(import.meta.dirname, '../../docs/images/live.gif')
const PORT = 5610
const SEED = 7
const LOT = Number(process.env.LOT ?? 19)

/** The clean wafers the live baseline learns from: wafers 1 to 3 of lots 1 to 10, as the public baseline has. */
const CLEAN = Array.from({ length: 10 }, (_, lot) => [1, 2, 3].map((wafer) => [lot + 1, wafer])).flat()

/** How much faster than real time the filmed wafer etches: its 11 minutes play in about 10 seconds. */
const FILMED_RATE = 60

/** How much the GIF speeds the video up, and how it samples it. */
const GIF_SPEED = 0.6
const GIF_FPS = 10
const GIF_WIDTH = 960

const VIEWPORT = { width: 1280, height: 860 }

function defaultBinary() {
  const base = resolve(import.meta.dirname, '../../chamber-sim/build/chamber-sim')
  return existsSync(`${base}.exe`) ? `${base}.exe` : base
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

async function api(path, init = {}) {
  const response = await fetch(APP + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  })
  if (!response.ok) {
    throw new Error(`${path} answered ${response.status}: ${await response.text()}`)
  }
  return response.json()
}

/** Starts the simulator for one wafer and resolves once it is listening. */
function simulate(lot, wafer, rate, fault) {
  const args = [`--port=${PORT}`, `--rate=${rate}`, `--seed=${SEED}`, `--lot=${lot}`, `--wafer=${wafer}`]
  const child = spawn(BINARY, fault ? [...args, '--fault=random'] : args, { stdio: ['ignore', 'pipe', 'inherit'] })
  return new Promise((listening, failed) => {
    child.once('error', failed)
    child.stdout.once('data', () => listening(child))
  })
}

function exited(child) {
  return child.exitCode !== null ? Promise.resolve() : new Promise((done) => child.once('exit', done))
}

/** Waits until the recording that was just started has stored its run, or says why it did not. */
async function recorded() {
  for (;;) {
    const session = await api('/api/live/session')
    if (!session.recording && (session.stored !== null || session.failure !== null)) {
      if (session.failure !== null) {
        throw new Error(`the recording stopped: ${session.failure}`)
      }
      return session.stored
    }
    await sleep(250)
  }
}

async function streamClean(lot, wafer) {
  const simulator = await simulate(lot, wafer, 0, false)
  await api('/api/live/start', { method: 'POST', body: JSON.stringify({ host: '127.0.0.1', port: PORT }) })
  const stored = await recorded()
  await exited(simulator)
  return stored
}

async function film(videoDir) {
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: VIEWPORT, colorScheme: 'light', recordVideo: { dir: videoDir, size: VIEWPORT } })
  const page = await context.newPage()
  await page.goto(`${APP}/live`)
  await page.getByRole('heading', { level: 1, name: 'Live chamber' }).waitFor()
  await sleep(1500)

  const simulator = await simulate(LOT, 4, FILMED_RATE, true)
  await page.getByRole('button', { name: /Record from/ }).click()
  await page.getByRole('heading', { level: 2, name: 'Etching now' }).waitFor()
  await page.getByRole('heading', { level: 2, name: 'The last wafer it recorded' }).waitFor({ timeout: 180_000 })
  await exited(simulator)
  await sleep(2500)

  await page.getByRole('link', { name: 'open its page' }).click()
  await page.getByRole('heading', { level: 2, name: 'Channels by rank' }).waitFor()
  await sleep(3000)
  await page.locator('figure.chart').first().scrollIntoViewIfNeeded()
  await sleep(3500)

  const run = await page.getByRole('heading', { level: 1 }).textContent()
  await context.close()
  await browser.close()
  return run
}

async function main() {
  if (!existsSync(BINARY)) {
    throw new Error(`no simulator at ${BINARY}; run make in chamber-sim`)
  }
  const settings = await api('/api/settings')
  if (settings.readOnly) {
    throw new Error('this ChamberWatch is read-only, so it cannot record live runs')
  }
  for (const [lot, wafer] of CLEAN) {
    await streamClean(lot, wafer)
  }
  console.log(`${CLEAN.length} clean wafers stored or found`)
  const videoDir = mkdtempSync(join(tmpdir(), 'chamberwatch-live-'))
  try {
    const run = await film(videoDir)
    const video = readdirSync(videoDir).find((name) => name.endsWith('.webm'))
    if (video === undefined) {
      throw new Error('the browser saved no video')
    }
    const filter = `setpts=${GIF_SPEED}*PTS,fps=${GIF_FPS},scale=${GIF_WIDTH}:-1:flags=lanczos,split[a][b];`
      + '[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle'
    const ffmpeg = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(videoDir, video), '-vf', filter, '-loop', '0', OUT],
      { stdio: 'inherit' })
    if (ffmpeg.status !== 0) {
      throw new Error('ffmpeg could not make the GIF')
    }
    console.log(`filmed ${run}; wrote ${OUT}`)
  }
  finally {
    rmSync(videoDir, { recursive: true, force: true })
  }
}

await main()
