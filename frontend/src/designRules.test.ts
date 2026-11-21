import { describe, expect, it } from 'vitest'
import sheet from './index.css?raw'

interface Rule {
  readonly selector: string
  readonly body: string
}

/** Every rule of the stylesheet that holds declarations, whether or not a media or container query wraps it. */
function rulesOf(css: string): Rule[] {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: (match[1] ?? '').trim().replace(/\s+/g, ' '),
    body: match[2] ?? '',
  }))
}

/** The values a property is given across the stylesheet, each with the selector that sets it. */
function valuesOf(rules: readonly Rule[], property: string): { selector: string; value: string }[] {
  return rules.flatMap((rule) => [...rule.body.matchAll(new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`, 'g'))]
    .map((match) => ({ selector: rule.selector, value: (match[1] ?? '').trim() })))
}

const rules = rulesOf(sheet)

// DESIGN.md at the repository root states these rules; the stylesheet drifted from them once, so they are pinned here
describe('the stylesheet against DESIGN.md', () => {
  it('rounds controls by 6px, segmented buttons by 4px and marks by 2px, and nothing else but dots', () => {
    const radii = valuesOf(rules, 'border-radius')

    expect(radii.length).toBeGreaterThan(20)
    for (const { selector, value } of radii) {
      const allowed = selector === '.segmented button' ? ['4px'] : ['2px', '6px', '50%']
      expect(allowed, `${selector} { border-radius: ${value} }`).toContain(value)
    }
  })

  it('leaves the focus ring to follow its element, with no radius of its own', () => {
    const focus = rules.filter((rule) => rule.selector.includes(':focus-visible'))

    expect(focus.length).toBeGreaterThan(0)
    expect(valuesOf(focus, 'border-radius')).toEqual([])
  })

  it('takes every font size from the type scale', () => {
    // 16px is the root size, and 34px and 16px are the phone sizes of the headline and the lead paragraph
    const offScale = ['16px', '12px', '2.125rem', '1rem', '0.9em', '0.95em']
    const sizes = valuesOf(rules, 'font-size')

    expect(sizes.length).toBeGreaterThan(50)
    for (const { selector, value } of sizes) {
      expect(/^var\(--text-[a-z0-9]+\)$/.test(value) || offScale.includes(value), `${selector} { font-size: ${value} }`).toBe(true)
    }
  })

  it('carries no shadow except the chart readout that floats', () => {
    // an inset line and a 1px ring are edges, not shadows
    const shadows = valuesOf(rules, 'box-shadow')
      .filter(({ value }) => value !== 'none' && !value.startsWith('inset') && !value.startsWith('0 0 0 '))

    expect(shadows.map(({ selector }) => selector)).toEqual(['.readout'])
  })
})
