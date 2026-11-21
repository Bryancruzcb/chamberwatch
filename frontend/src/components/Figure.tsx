import type { ReactNode } from 'react'

/**
 * A section of a page that shows data, set like a figure in a report: a 2px ink rule, a "Fig. n" label, the title and
 * an optional control on one line, an optional one-line answer, then the chart or table. The stylesheet counts the
 * numbered figures of a page in order, so a figure that is absent never leaves a gap. A small panel that holds no data
 * of its own (relabel, alignment) passes `numbered={false}` and keeps the rule and the title.
 *
 * The section is a region named by its title, which is how tests and screen readers find it.
 */
export function Figure({ id, title, control, answer, numbered = true, busy, className, children }: {
  /** The heading's id is `${id}-title`. */
  id: string
  title: ReactNode
  /** A text switch or link set at the right of the title, such as the Source switch. */
  control?: ReactNode
  /** The sentence that answers the figure's question. */
  answer?: ReactNode
  numbered?: boolean
  /** Set while the figure shows a placeholder for data on its way; left out, the attribute is left out. */
  busy?: boolean
  className?: string
  children?: ReactNode
}) {
  const classes = ['figure', numbered ? 'numbered' : null, className ?? null].filter((name) => name !== null).join(' ')
  return (
    <section className={classes} aria-labelledby={`${id}-title`} aria-busy={busy}>
      <div className="figure-head">
        {numbered && <span className="fig-no" aria-hidden="true" />}
        <h2 id={`${id}-title`}>{title}</h2>
        {control !== undefined && <div className="figure-control">{control}</div>}
      </div>
      {answer !== undefined && answer !== null && <p className="figure-answer">{answer}</p>}
      {children}
    </section>
  )
}
