import { useEffect, useState } from 'react'
import { applyTheme, effectiveTheme, readStoredTheme, storeTheme, type Theme } from '../theme'
import { Icon } from './Icon'

const DARK_QUERY = '(prefers-color-scheme: dark)'

/** Switches between light and dark. Until it is pressed the page follows the system. */
export function ThemeToggle() {
  const [picked, setPicked] = useState<Theme | null>(readStoredTheme)
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(DARK_QUERY).matches)

  useEffect(() => {
    const query = window.matchMedia(DARK_QUERY)
    const follow = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    query.addEventListener('change', follow)
    return () => query.removeEventListener('change', follow)
  }, [])

  useEffect(() => {
    applyTheme(picked)
  }, [picked])

  const next: Theme = effectiveTheme(picked, systemDark) === 'dark' ? 'light' : 'dark'
  return (
    <button
      type="button"
      className="theme-button"
      aria-label={`Switch to ${next} mode`}
      onClick={() => {
        storeTheme(next)
        setPicked(next)
      }}
    >
      <Icon name={next === 'dark' ? 'moon' : 'sun'} />
    </button>
  )
}
