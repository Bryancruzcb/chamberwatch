import type { MeasurementPoint } from './api/schema'

// How a wafer's measured depth varies from its center to its edge. Only calculations: the depth page draws them.

export interface RadialPoint {
  readonly radiusMm: number
  readonly depthUm: number
}

/** Every measured site by its distance from the wafer's center, nearest first. */
export function radialProfile(sites: readonly MeasurementPoint[]): RadialPoint[] {
  return sites
    .map((site) => ({ radiusMm: Math.hypot(site.xUm, site.yUm) / 1000, depthUm: site.depthUm }))
    .sort((a, b) => a.radiusMm - b.radiusMm)
}

/**
 * The mean depth of the third of the sites nearest the center and of the third nearest the edge. Null with fewer than
 * three sites, where a third is not a site.
 */
export function centerAndEdge(sites: readonly MeasurementPoint[]): { centerUm: number; edgeUm: number } | null {
  const profile = radialProfile(sites)
  const third = Math.floor(profile.length / 3)
  if (third === 0) {
    return null
  }
  const mean = (points: readonly RadialPoint[]) => points.reduce((sum, point) => sum + point.depthUm, 0) / points.length
  return { centerUm: mean(profile.slice(0, third)), edgeUm: mean(profile.slice(-third)) }
}
