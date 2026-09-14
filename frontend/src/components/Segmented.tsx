/** A row of mutually exclusive buttons, the one in effect pressed. */
export function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string
  value: T
  options: ReadonlyArray<readonly [value: T, text: string]>
  onChange: (value: T) => void
}) {
  return (
    <div className="field">
      <span aria-hidden="true">{label}</span>
      <div className="segmented" role="group" aria-label={label}>
        {options.map(([option, text]) => (
          <button key={option} type="button" aria-pressed={option === value} onClick={() => onChange(option)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}
