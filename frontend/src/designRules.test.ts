import { describe, expect, it } from 'vitest'
import sheet from './index.css?raw'

interface Rule {
  readonly selector: string
  readonly body: string
}

const plain = sheet.replace(/\/\*[\s\S]*?\*\//g, '')

/** Every rule of the stylesheet that holds declarations, whether or not a media or container query wraps it. */
function rulesOf(css: string): Rule[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: (match[1] ?? '').trim().replace(/\s+/g, ' '),
    body: match[2] ?? '',
  }))
}

/** The values a property is given across the stylesheet, each with the selector that sets it. */
function valuesOf(rules: readonly Rule[], property: string): { selector: string; value: string }[] {
  return rules.flatMap((rule) => [...rule.body.matchAll(new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`, 'g'))]
    .map((match) => ({ selector: rule.selector, value: (match[1] ?? '').trim() })))
}

/** The custom properties a rule declares, by name. */
function tokensOf(rule: Rule | undefined): Map<string, string> {
  return new Map([...(rule?.body ?? '').matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((match) => [match[1] ?? '', (match[2] ?? '').trim()]))
}

const rules = rulesOf(plain)
const light = tokensOf(rules.find((rule) => rule.selector === ':root'))
const darkPicked = tokensOf(rules.find((rule) => rule.selector === ":root[data-theme='dark']"))
const darkSystem = tokensOf(rules.find((rule) => rule.selector === ":root:not([data-theme='light'])"))
const typeScale = [...light.entries()].filter(([name]) => name.startsWith('--text-'))

// DESIGN.md at the repository root states these rules; the stylesheet drifted from them once, so they are pinned here
describe('the stylesheet against DESIGN.md', () => {
  it('rounds real controls by 6px, bars and marks by 2px, discs and dots fully, and nothing else', () => {
    const radii = valuesOf(rules, 'border-radius')

    expect(radii.length).toBeGreaterThan(15)
    for (const { selector, value } of radii) {
      expect(['2px', '6px', '50%'], `${selector} { border-radius: ${value} }`).toContain(value)
      // 6px is for something to press or choose from, and the readout that floats over a chart
      if (value === '6px') {
        expect(/button|select|\.readout/.test(selector), `${selector} is not a control`).toBe(true)
      }
    }
  })

  it('leaves the focus ring to follow its element, with no radius of its own', () => {
    const focus = rules.filter((rule) => rule.selector.includes(':focus-visible'))

    expect(focus.length).toBeGreaterThan(0)
    expect(valuesOf(focus, 'border-radius')).toEqual([])
  })

  it('keeps one type scale of at most ten steps, none under 12px, each named for its size', () => {
    expect(typeScale.length).toBeGreaterThanOrEqual(6)
    expect(typeScale.length).toBeLessThanOrEqual(10)
    for (const [name, value] of typeScale) {
      const rem = /^([\d.]+)rem$/.exec(value)
      expect(rem, `${name}: ${value} is not in rem`).not.toBeNull()
      const px = Number(rem?.[1]) * 16
      expect(px, `${name} is under 12px`).toBeGreaterThanOrEqual(12)
      expect(name, `${name} is ${px}px`).toBe(`--text-${px}`)
    }
  })

  it('takes every font size from the type scale', () => {
    const steps = new Set(typeScale.map(([name]) => `var(${name})`))
    const sizes = valuesOf(rules, 'font-size')

    expect(sizes.length).toBeGreaterThan(50)
    for (const { selector, value } of sizes) {
      expect(steps.has(value), `${selector} { font-size: ${value} }`).toBe(true)
    }
    // the shorthand would slip a size past the check above; controls only inherit the page's font
    expect(valuesOf(rules, 'font').filter(({ value }) => value !== 'inherit')).toEqual([])
  })

  it('carries no shadow except the chart readout that floats', () => {
    // an inset line and a ring around a disc are edges, not shadows
    const shadows = valuesOf(rules, 'box-shadow')
      .filter(({ value }) => value !== 'none' && !value.startsWith('inset') && !value.startsWith('0 0 0 '))

    expect(shadows.map(({ selector }) => selector)).toEqual(['.readout'])
  })

  it('swaps every color for dark mode the same way, whether the system or the theme button picks it', () => {
    const colors = [...light.entries()].filter(([, value]) => /^(#|rgba?\()/.test(value) || value.includes('rgba(')).map(([name]) => name)

    expect(colors).toContain('--signal')
    expect([...darkPicked.keys()].sort()).toEqual(colors.sort())
    expect([...darkSystem.entries()].sort()).toEqual([...darkPicked.entries()].sort())
  })

  it('takes every color from a token, so dark mode reaches everything', () => {
    const outside = rules.filter((rule) => !rule.selector.startsWith(':root'))
    const literals = outside.flatMap((rule) => [...rule.body.matchAll(/#[0-9a-f]{3,8}\b|rgba?\(/gi)].map((match) => `${rule.selector}: ${match[0]}`))

    expect(literals).toEqual([])
  })
})
