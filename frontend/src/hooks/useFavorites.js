import { useState, useCallback, useEffect } from 'react'
import { getFavorites, addFavorite, removeFavorite } from '../api/client'

const LS_KEY = 'jp_favorites'

function loadLocal() {
  try { return new Set(JSON.parse(localStorage.getItem(LS_KEY) || '[]')) }
  catch { return new Set() }
}

export function useFavorites() {
  const [favorites, setFavorites] = useState(loadLocal)

  useEffect(() => {
    const init = async () => {
      try {
        const { data } = await getFavorites()
        const serverSet = new Set(data.codes)

        // Migrate any localStorage codes not yet on the server
        const localCodes = loadLocal()
        const toMigrate = [...localCodes].filter(c => !serverSet.has(c))
        await Promise.all(toMigrate.map(c => addFavorite(c).catch(() => {})))

        setFavorites(new Set([...serverSet, ...toMigrate]))
        localStorage.removeItem(LS_KEY)
      } catch {
        // API unavailable — keep using localStorage state
      }
    }
    init()
  }, [])

  const toggle = useCallback((code) => {
    setFavorites(prev => {
      const next = new Set(prev)
      if (next.has(code)) {
        next.delete(code)
        removeFavorite(code).catch(() => {
          setFavorites(p => { const r = new Set(p); r.add(code); return r })
        })
      } else {
        next.add(code)
        addFavorite(code).catch(() => {
          setFavorites(p => { const r = new Set(p); r.delete(code); return r })
        })
      }
      return next
    })
  }, [])

  return { favorites, toggle }
}
