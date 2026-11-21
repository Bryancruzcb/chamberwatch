import type { MeasurementPoint } from './api/schema'

// How a wafer's measured depth varies from its center to its edge. Only calculations: the depth page draws them.

export interface RadialPoint {
  readonly radiusMm: number
  readonly depthUm: number
}

/**
 * Every measured site by its distance from the wafer's center, nearest first, and shallowest first at one distance, so
 * the order never depends on the order the rows arrived in.
 */
export function radialProfile(sites: readonly MeasurementPoint[]): RadialPoint[] {
  return sites
    .map((site) => ({ radiusMm: Math.hypot(site.xUm, site.yUm) / 1000, depthUm: site.depthUm }))
    .sort((a, b) => a.radiusMm - b.radiusMm || a.depthUm - b.depthUm)
}

/** Sites closer in radius than this sit on one ring. The public rings are at least 1.8 mm apart. */
const SAME_RING_MM = 0.001

/**
 * The mean depth of the sites nearest the center and of those nearest the edge: a third of the sites each, widened so
 * that a ring of sites at the same distance is never split. Splitting one would let the order of the rows decide which
 * of its sites count, and on a 9-point wafer that moves the answer by more than its size. Null with fewer than three
 * sites, where a third is not a site, and when the two groups would share a ring.
 */
export function centerAndEdge(sites: readonly MeasurementPoint[]): { centerUm: number; edgeUm: number } | null {
  const profile = radialProfile(sites)
  const third = Math.floor(profile.length / 3)
  const lastCenter = profile[third - 1]
  const firstEdge = profile[profile.length - third]
  if (third === 0 || lastCenter === undefined || firstEdge === undefined) {
    return null
  }
  const innerMm = lastCenter.radiusMm + SAME_RING_MM
  const outerMm = firstEdge.radiusMm - SAME_RING_MM
  if (innerMm >= outerMm) {
    return null
  }
  const mean = (points: readonly RadialPoint[]) => points.reduce((sum, point) => sum + point.depthUm, 0) / points.length
  return {
    centerUm: mean(profile.filter((point) => point.radiusMm <= innerMm)),
    edgeUm: mean(profile.filter((point) => point.radiusMm >= outerMm)),
  }
}
