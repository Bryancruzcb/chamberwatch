import { formatMicrons } from '../format'

const percent = (share: number) => `${(share * 100).toFixed(3)}%`

/**
 * The predicted depth with the lot's typical miss around it as a band, and the measured depth as a mark on the same
 * scale, so a reader sees at once whether the measurement fell inside what the model expected.
 */
export function PredictionStrip({ predictedUm, measuredUm, missUm }: { predictedUm: number; measuredUm: number | null; missUm: number | null }) {
  const band = missUm === null ? null : [predictedUm - missUm, predictedUm + missUm] as const
  const values = [predictedUm, ...(measuredUm === null ? [] : [measuredUm]), ...(band ?? [])]
  const low = Math.min(...values)
  const high = Math.max(...values)
  // a margin on either side, so neither mark sits on the strip's edge
  const pad = Math.max((high - low) * 0.35, 0.02)
  const from = low - pad
  const to = high + pad
  const at = (um: number) => (um - from) / (to - from)
  const label = `Predicted ${formatMicrons(predictedUm)}`
    + `${band === null ? '' : `, typically within ${formatMicrons(missUm)}`}`
    + `${measuredUm === null ? '' : `; measured ${formatMicrons(measuredUm)}`}.`
  return (
    <figure className="strip" role="img" aria-label={label}>
      <div className="strip-track" aria-hidden="true">
        {band !== null && (
          <span className="strip-band" style={{ left: percent(at(band[0])), width: percent(at(band[1]) - at(band[0])) }} />
        )}
        <span className="strip-mark predicted" style={{ left: percent(at(predictedUm)) }}>
          <span className="strip-label below">{`Predicted ${formatMicrons(predictedUm)}`}</span>
        </span>
        {measuredUm !== null && (
          <span className="strip-mark measured" style={{ left: percent(at(measuredUm)) }}>
            <span className="strip-label above">{`Measured ${formatMicrons(measuredUm)}`}</span>
          </span>
        )}
      </div>
      {band !== null && (
        <figcaption className="strip-key" aria-hidden="true">
          <i className="strip-swatch" />
          {`the lot's typical miss, ± ${formatMicrons(missUm)}`}
        </figcaption>
      )}
    </figure>
  )
}
