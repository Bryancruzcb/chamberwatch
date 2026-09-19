import { z } from 'zod'

// The API's JSON, parsed where it enters the app. The shapes follow the records in the backend's ReadQueries. A few
// are reshaped on the way in, so a combination the server never sends cannot be represented here.

const id = z.number().int()
const count = z.number().int().nonnegative()
const seconds = z.number()

export const sourceSchema = z.enum(['PUBLIC', 'SYNTHETIC'])
export const labelSchema = z.enum(['AUTO', 'GOOD', 'BAD'])
export const phaseSchema = z.enum(['SF6', 'C4F8'])
export const alignmentStatusSchema = z.enum(['ALIGNED', 'DEGRADED', 'FAILED'])

export type Source = z.infer<typeof sourceSchema>
export type Label = z.infer<typeof labelSchema>
export type Phase = z.infer<typeof phaseSchema>
export type AlignmentStatus = z.infer<typeof alignmentStatusSchema>

export const conditioningSurfaceSchema = z.enum(['CHUCK', 'SILICON', 'OXIDE'])
export type ConditioningSurface = z.infer<typeof conditioningSurfaceSchema>

export const lotSchema = z.object({
  id,
  source: sourceSchema,
  lotNo: count,
  runDate: z.string().nullable(),
  conditioningCount: count.nullable(),
  conditioningSurface: conditioningSurfaceSchema.nullable(),
  runs: count,
  flaggedRuns: count,
})
export const lotsSchema = z.array(lotSchema)
export type Lot = z.infer<typeof lotSchema>

export const baselineSchema = z.object({ id, goodRuns: count, k: z.number(), n: count, runZ: z.number() })
export type Baseline = z.infer<typeof baselineSchema>

/** How a run scored under the current baseline. `stuckFlags` counts holds that passed the stuck rule. */
export const scoreSchema = z.object({
  limitFlags: count,
  deviationFlags: count,
  stuckFlags: count,
  persistentZ: z.number(),
  firstChannel: z.string().nullable(),
  firstTimeS: seconds.nullable(),
})
export type Score = z.infer<typeof scoreSchema>

/** Whether any detector flagged the run. */
export function isFlagged(score: Score | null): boolean {
  return score !== null && score.limitFlags + score.deviationFlags + score.stuckFlags > 0
}

const runRowWire = z.object({
  id,
  key: z.string(),
  lotId: id,
  lotNo: count,
  positionInLot: count,
  label: labelSchema,
  alignment: alignmentStatusSchema,
  good: z.boolean(),
  scored: z.boolean(),
  limitFlags: count.nullable(),
  deviationFlags: count.nullable(),
  stuckFlags: count.nullable(),
  persistentZ: z.number().nullable(),
  firstChannel: z.string().nullable(),
  firstTimeS: seconds.nullable(),
})

/** One row of the runs table. `score` is null for a run not scored under the current baseline. */
export const runRowSchema = runRowWire.transform((row, ctx) => {
  const { scored, limitFlags, deviationFlags, stuckFlags, persistentZ, firstChannel, firstTimeS, ...run } = row
  if (!scored) {
    return { ...run, score: null }
  }
  if (limitFlags === null || deviationFlags === null || stuckFlags === null || persistentZ === null) {
    ctx.addIssue({ code: 'custom', message: `${run.key} is scored but carries no flag counts` })
    return z.NEVER
  }
  return { ...run, score: { limitFlags, deviationFlags, stuckFlags, persistentZ, firstChannel, firstTimeS } }
})
export type RunRow = z.infer<typeof runRowSchema>

export const runsPageSchema = z.object({ baseline: baselineSchema.nullable(), runs: z.array(runRowSchema) })
export type RunsPage = z.infer<typeof runsPageSchema>

const alignmentWire = z.object({
  status: alignmentStatusSchema,
  note: z.string().nullable(),
  etchStartS: seconds.nullable(),
  etchEndS: seconds.nullable(),
  cycle1Sf6: z.boolean().nullable(),
  c4f8Phases: count.nullable(),
  lastCycle: count.nullable(),
  onsetsDetected: count.nullable(),
  onsetsPredicted: count.nullable(),
  gapStartS: seconds.nullable(),
  gapLengthS: seconds.nullable(),
  gapInsideEtch: z.boolean().nullable(),
  irregularCycles: z.array(count),
})

/** A failed run has only the reason; a run that aligned, cleanly or not, has the whole report. */
export const alignmentSchema = alignmentWire.transform((report, ctx) => {
  if (report.status === 'FAILED') {
    return { kind: 'failed' as const, note: report.note }
  }
  const { etchStartS, etchEndS, cycle1Sf6, c4f8Phases, lastCycle, onsetsDetected, onsetsPredicted } = report
  if (etchStartS === null || etchEndS === null || cycle1Sf6 === null || c4f8Phases === null || lastCycle === null
    || onsetsDetected === null || onsetsPredicted === null) {
    ctx.addIssue({ code: 'custom', message: 'an aligned run is missing its alignment report' })
    return z.NEVER
  }
  const gap = report.gapStartS === null || report.gapLengthS === null
    ? null
    : { startS: report.gapStartS, lengthS: report.gapLengthS, insideEtch: report.gapInsideEtch === true }
  return {
    kind: 'aligned' as const,
    status: report.status,
    note: report.note,
    etchStartS,
    etchEndS,
    cycle1Sf6,
    c4f8Phases,
    lastCycle,
    onsetsDetected,
    onsetsPredicted,
    gap,
    irregularCycles: report.irregularCycles,
  }
})
export type Alignment = z.infer<typeof alignmentSchema>

export const excursionSchema = z.object({
  channel: z.string(),
  startSlot: count,
  confirmSlot: count,
  endSlot: count,
  cycle: count,
  phase: phaseSchema,
  offset: count,
  startTimeS: seconds.nullable(),
  confirmTimeS: seconds.nullable(),
  endTimeS: seconds.nullable(),
  outSamples: count,
  peakZ: z.number(),
})
export type Excursion = z.infer<typeof excursionSchema>

/** A channel's mean and spread over one phase, against the good runs' band for each. */
export const phaseEvidenceSchema = z.object({
  phase: phaseSchema,
  mean: z.number().nullable(),
  sd: z.number().nullable(),
  goodMean: z.number().nullable(),
  goodMeanSd: z.number().nullable(),
  meanZ: z.number().nullable(),
  goodSd: z.number().nullable(),
  goodSdSd: z.number().nullable(),
  sdZ: z.number().nullable(),
})
export type PhaseEvidence = z.infer<typeof phaseEvidenceSchema>

/** A hold that passed the stuck rule: one value reported for longer than any good run held one on the channel. */
export const holdSchema = z.object({
  channel: z.string(),
  startSlot: count,
  confirmSlot: count,
  endSlot: count,
  cycle: count,
  phase: phaseSchema,
  offset: count,
  startTimeS: seconds.nullable(),
  confirmTimeS: seconds.nullable(),
  endTimeS: seconds.nullable(),
  samples: count,
  value: z.number(),
})
export type Hold = z.infer<typeof holdSchema>

/** `longestHold` is the channel's longest run of one value in samples, whether or not it passed the rule. */
export const channelSchema = z.object({
  channel: z.string(),
  rank: count,
  persistentZ: z.number(),
  deviation: z.boolean(),
  maxAbsSummaryZ: z.number(),
  longestHold: count,
  phases: z.array(phaseEvidenceSchema),
  excursions: z.array(excursionSchema),
  holds: z.array(holdSchema),
})
export type Channel = z.infer<typeof channelSchema>

export const faultKindSchema = z.enum(['GAS_FLOW_STUCK_LOW', 'PRESSURE_SPIKE', 'REFLECTED_POWER_RISE', 'SENSOR_DROPOUT', 'SENSOR_STUCK'])
export type FaultKind = z.infer<typeof faultKindSchema>

/**
 * The fault the simulator put into a synthetic run, in the run's own seconds. `durationS` is null for a fault that
 * lasted to the end of the etch, and for a reflected power rise it is the ramp. `magnitude` is the share of its flow
 * a stuck gas still delivers, a pressure rise as a share of the SF6 pressure, watts of reflected power, or 0.
 */
export const injectedFaultSchema = z.object({
  kind: faultKindSchema,
  channel: z.string(),
  startS: seconds,
  endS: seconds,
  durationS: seconds.nullable(),
  magnitude: z.number(),
})
export type InjectedFault = z.infer<typeof injectedFaultSchema>

export const measurementSetSchema = z.enum(['NINE_POINT', 'EIGHTY_NINE_POINT'])
export type MeasurementSet = z.infer<typeof measurementSetSchema>

/**
 * The wafer's mean measured depth in one measurement set. `lossUm` is how much shallower that is than the mean of
 * its lot's first `referenceWafers` wafers, and null when none of those was measured in the set.
 */
const measuredDepthSchema = z.object({
  set: measurementSetSchema,
  points: count,
  meanDepthUm: z.number(),
  lossUm: z.number().nullable(),
  referenceWafers: count,
})
export type MeasuredDepth = z.infer<typeof measuredDepthSchema>

/**
 * `injectedFault` is null for public runs and for clean synthetic ones. `measuredDepth` has the 89-point set first
 * and is empty for a wafer nobody measured.
 */
export const runDetailSchema = z.object({
  id,
  key: z.string(),
  source: sourceSchema,
  lotId: id,
  lotNo: count,
  runDate: z.string().nullable(),
  positionInLot: count,
  label: labelSchema,
  sampleCount: count,
  alignment: alignmentSchema,
  baseline: baselineSchema.nullable(),
  good: z.boolean(),
  assessment: scoreSchema.nullable(),
  channels: z.array(channelSchema),
  injectedFault: injectedFaultSchema.nullable(),
  measuredDepth: z.array(measuredDepthSchema),
})
export type RunDetail = z.infer<typeof runDetailSchema>

const tracePointWire = z.object({
  startS: seconds,
  endS: seconds,
  samples: count,
  min: z.number(),
  max: z.number(),
  slot: count.nullable(),
  cycle: count.nullable(),
  phase: phaseSchema.nullable(),
  offset: count.nullable(),
  bandMean: z.number().nullable(),
  bandSd: z.number().nullable(),
})

/**
 * One bucket of a trace. `position` is where in the recipe its first slotted sample sits, null outside the etch.
 * `band` is the good runs' band there, with a null sd where the slot has a mean but no band.
 */
export const tracePointSchema = tracePointWire.transform(({ slot, cycle, phase, offset, bandMean, bandSd, ...bucket }) => ({
  ...bucket,
  position: slot === null || cycle === null || phase === null || offset === null ? null : { slot, cycle, phase, offset },
  band: bandMean === null ? null : { mean: bandMean, sd: bandSd },
}))
export type TracePoint = z.infer<typeof tracePointSchema>

export const traceSchema = z.object({
  channel: z.string(),
  role: z.enum(['INFORMATIVE', 'CONSTANT']).nullable(),
  k: z.number().nullable(),
  fromCycle: count.nullable(),
  toCycle: count.nullable(),
  samples: count,
  points: z.array(tracePointSchema),
  excursions: z.array(excursionSchema),
})
export type Trace = z.infer<typeof traceSchema>

/** What the server allows. A read-only one, a public demo, refuses relabels. */
export const settingsSchema = z.object({ readOnly: z.boolean() })

export const relabelResultSchema = z.object({
  baselineId: id.nullable(),
  goodRuns: count.nullable(),
  fitted: z.boolean(),
  scored: count,
  flagged: count,
  current: z.boolean(),
})
export type RelabelResult = z.infer<typeof relabelResultSchema>

/**
 * A refresh that a relabel started, folded into what the page does next: wait, show what the refit did, or say why
 * it failed. `result` comes with `DONE` and `error` with `FAILED`.
 */
export const refreshSchema = z.object({
  id,
  source: sourceSchema,
  state: z.enum(['RUNNING', 'DONE', 'FAILED']),
  result: relabelResultSchema.nullable(),
  error: z.string().nullable(),
}).transform((refresh, ctx) => {
  if (refresh.state === 'RUNNING') {
    return { kind: 'running', id: refresh.id } as const
  }
  if (refresh.state === 'DONE' && refresh.result !== null) {
    return { kind: 'done', id: refresh.id, result: refresh.result } as const
  }
  if (refresh.state === 'FAILED' && refresh.error !== null) {
    return { kind: 'failed', id: refresh.id, message: refresh.error } as const
  }
  ctx.addIssue({ code: 'custom', message: `refresh ${refresh.id} is ${refresh.state} without its ${refresh.state === 'DONE' ? 'result' : 'error'}` })
  return z.NEVER
})
export type Refresh = z.infer<typeof refreshSchema>

/** An RFC 9457 problem detail, read loosely because it only feeds an error message. */
export const problemSchema = z.object({ title: z.string().optional(), detail: z.string().optional() })


export const measurementPointSchema = z.object({
  pointNo: count,
  locId: z.string().nullable(),
  xUm: z.number(),
  yUm: z.number(),
  preoxUm: z.number(),
  postoxUm: z.number(),
  postoxMeasured: z.boolean(),
  stepheightUm: z.number(),
  depthUm: z.number(),
})
export type MeasurementPoint = z.infer<typeof measurementPointSchema>

export const measurementsSchema = z.object({
  set: measurementSetSchema,
  points: count,
  meanDepthUm: z.number().nullable(),
  sdDepthUm: z.number().nullable(),
  values: z.array(measurementPointSchema),
})
export type Measurements = z.infer<typeof measurementsSchema>

export const driftStateSchema = z.enum(['INSUFFICIENT_RUNS', 'OUT_OF_BAND', 'NO_TREND', 'WILL_EXIT', 'STAYS_IN'])
export type DriftState = z.infer<typeof driftStateSchema>

export const driftRuleSchema = z.object({ k: z.number(), minRuns: count, minAbsT: z.number(), plannedLotSize: count })
export type DriftRule = z.infer<typeof driftRuleSchema>

const driftPointWire = z.object({
  runId: id,
  key: z.string(),
  position: count,
  value: z.number(),
  z: z.number(),
  runs: count,
  slope: z.number().nullable(),
  intercept: z.number().nullable(),
  tStat: z.number().nullable(),
  fitted: z.number().nullable(),
  state: driftStateSchema,
  firstOutPosition: count.nullable(),
  runsRemaining: count.nullable(),
})

/** One wafer on the lot page. `fit` is the line through the wafers so far, null at the first wafer. */
export const driftPointSchema = driftPointWire.transform(({ slope, intercept, fitted, tStat, ...point }) => ({
  ...point,
  fit: slope === null || intercept === null || fitted === null ? null : { slope, intercept, fitted, tStat },
}))
export type DriftPoint = z.infer<typeof driftPointSchema>

export const driftChannelSchema = z.object({
  channel: z.string(),
  bandMean: z.number(),
  bandSd: z.number(),
  low: z.number(),
  high: z.number(),
  state: driftStateSchema,
  points: z.array(driftPointSchema),
})
export type DriftChannel = z.infer<typeof driftChannelSchema>

/** What centers each channel's drift band: the good runs of every lot, or this lot's own first wafers. */
export const driftReferenceSchema = z.enum(['GLOBAL', 'LOT'])
export type DriftReference = z.infer<typeof driftReferenceSchema>

export const lotDriftSchema = z.object({
  lot: lotSchema,
  phase: phaseSchema,
  baseline: baselineSchema.nullable(),
  rule: driftRuleSchema,
  reference: driftReferenceSchema,
  referenceWafers: count,
  channels: z.array(driftChannelSchema),
})
export type LotDrift = z.infer<typeof lotDriftSchema>

export const positionDepthSchema = z.object({
  set: measurementSetSchema,
  wafers: count,
  meanDepthUm: z.number(),
  meanDepthLossUm: z.number().nullable(),
})

export const positionDriftSchema = z.object({
  position: count,
  runs: count,
  scoredRuns: count,
  meanDriftScore: z.number().nullable(),
  flaggedRuns: count,
  depth: z.array(positionDepthSchema),
})
export type PositionDrift = z.infer<typeof positionDriftSchema>

export const driftVsDepthSchema = z.object({
  source: sourceSchema,
  baseline: baselineSchema.nullable(),
  referenceWafers: count,
  positions: z.array(positionDriftSchema),
})
export type DriftVsDepth = z.infer<typeof driftVsDepthSchema>
