import { useState, useCallback } from 'react'

const KEY = 'jp_favorites'

function load() {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')) }
  catch { return new Set() }
}

function save(set) {
  try { localStorage.setItem(KEY, JSON.stringify([...set])) } catch {}
}

export function useFavorites() {
  const [favorites, setFavorites] = useState(load)

  const toggle = useCallback((code) => {
    setFavorites(prev => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      save(next)
      return next
    })
  }, [])

  return { favorites, toggle }
}
