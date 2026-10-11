// The color theme: the system's, unless the reader picked one with the toggle. The pick is kept in this browser only.

export type Theme = 'light' | 'dark'

const KEY = 'chamberwatch-theme'

/** The reader's pick, or null to follow the system. Storage can be missing or blocked, which means no pick. */
export function readStoredTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(KEY)
    return value === 'light' || value === 'dark' ? value : null
  }
  catch {
    return null
  }
}

export function storeTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(KEY, theme)
  }
  catch {
    // the pick still holds until the page reloads
  }
}

/** Sets the pick on the page; the stylesheet follows `data-theme` and otherwise the system. */
export function applyTheme(theme: Theme | null): void {
  if (theme === null) {
    document.documentElement.removeAttribute('data-theme')
  }
  else {
    document.documentElement.setAttribute('data-theme', theme)
  }
}

/** The theme on screen. */
export function effectiveTheme(picked: Theme | null, systemDark: boolean): Theme {
  return picked ?? (systemDark ? 'dark' : 'light')
}
