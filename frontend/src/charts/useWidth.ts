import { useCallback, useRef, useState } from 'react'

/** The rendered width of an element, kept current as the layout changes. Pass the returned callback as its ref. */
export function useWidth(): [number, (element: HTMLDivElement | null) => void] {
  const [width, setWidth] = useState(0)
  const observer = useRef<ResizeObserver | null>(null)
  const measure = useCallback((element: HTMLDivElement | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (element === null) {
      return
    }
    setWidth(Math.round(element.getBoundingClientRect().width))
    const watcher = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry !== undefined) {
        setWidth(Math.round(entry.contentRect.width))
      }
    })
    watcher.observe(element)
    observer.current = watcher
  }, [])
  return [width, measure]
}
