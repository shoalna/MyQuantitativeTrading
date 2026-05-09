import { createContext, useContext, useState } from 'react'
import translations from '../i18n'

export const LangContext = createContext(null)

export function LangProvider({ children }) {
  const [lang, setLangState] = useState(() => localStorage.getItem('lang') || 'en')

  const setLang = (l) => {
    localStorage.setItem('lang', l)
    setLangState(l)
  }

  const t = (key) => translations[lang]?.[key] ?? translations.en[key] ?? key

  return (
    <LangContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LangContext.Provider>
  )
}

export function useLang() {
  return useContext(LangContext)
}
