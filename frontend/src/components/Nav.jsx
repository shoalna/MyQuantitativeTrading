import { useState, useEffect, useRef } from 'react'
import { triggerJob, getJobs, getJob } from '../api/client'
import { useLang } from '../context/LangContext'
import { LANGUAGES } from '../i18n'

const STATUS_DOT = { pending: '#f59e0b', running: '#3b82f6', done: '#22c55e', failed: '#ef4444' }

export default function Nav({ page, onNav, onJobDone }) {
  const { lang, setLang, t } = useLang()
  const [job, setJob] = useState(null)
  const [loading, setLoading] = useState(false)
  const pollRef = useRef(null)

  const loadLatest = async () => {
    const { data } = await getJobs()
    if (data.length) setJob(data[0])
  }

  useEffect(() => { loadLatest() }, [])

  const startPolling = (id) => {
    clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      const { data } = await getJob(id)
      setJob(data)
      if (data.status === 'done' || data.status === 'failed') {
        clearInterval(pollRef.current)
        onJobDone?.()
      }
    }, 3000)
  }

  const handleRun = async () => {
    setLoading(true)
    try {
      const { data } = await triggerJob(lang)
      setJob(data)
      if (data.status === 'pending' || data.status === 'running') startPolling(data.id)
    } finally {
      setLoading(false)
    }
  }

  const isActive = job && (job.status === 'pending' || job.status === 'running')
  const status = job?.status || 'idle'

  return (
    <nav style={{
      position: 'sticky', top: 0, zIndex: 100,
      background: 'rgba(9,9,11,0.88)', backdropFilter: 'blur(14px)',
      borderBottom: '1px solid var(--border)',
      display: 'flex', alignItems: 'center',
      padding: '0 24px', height: 56, gap: 8,
    }}>
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 24 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8,
          background: 'linear-gradient(135deg,#3b82f6,#a855f7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 700,
        }}>◆</div>
        <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.01em' }}>
          Trading Guidance
        </span>
      </div>

      {/* Page nav */}
      <div style={{ display: 'flex', gap: 2 }}>
        {[['home', t('nav_home')], ['japan', t('nav_japan')], ['config', t('nav_config')]].map(([key, label]) => (
          <button key={key} onClick={() => onNav(key)} style={{
            background: page === key ? 'var(--bg-card)' : 'transparent',
            color: page === key ? 'var(--text-1)' : 'var(--text-2)',
            border: `1px solid ${page === key ? 'var(--border)' : 'transparent'}`,
            borderRadius: 'var(--r-xs)', padding: '5px 14px', fontSize: 13,
          }}>{label}</button>
        ))}
      </div>

      <div style={{ flex: 1 }} />

      {/* Language switcher */}
      <div style={{
        display: 'flex', gap: 2, padding: '3px', borderRadius: 'var(--r-xs)',
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
      }}>
        {Object.entries(LANGUAGES).map(([code, label]) => (
          <button key={code} onClick={() => setLang(code)} style={{
            background: lang === code ? 'var(--bg-card)' : 'transparent',
            color: lang === code ? 'var(--text-1)' : 'var(--text-3)',
            border: `1px solid ${lang === code ? 'var(--border)' : 'transparent'}`,
            borderRadius: 4, padding: '3px 10px', fontSize: 12, fontWeight: lang === code ? 600 : 400,
          }}>{label}</button>
        ))}
      </div>

      {/* Divider */}
      <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />

      {/* Job status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {job && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)' }}>
            <span style={{
              width: 7, height: 7, borderRadius: '50%',
              background: STATUS_DOT[status] || 'var(--text-3)',
              boxShadow: isActive ? `0 0 0 3px ${STATUS_DOT[status]}33` : 'none',
              animation: isActive ? 'navpulse 1.5s infinite' : 'none',
              flexShrink: 0,
            }} />
            <span style={{ textTransform: 'capitalize' }}>
              {status}
              {job.language && job.language !== 'en' && (
                <span style={{ marginLeft: 4, opacity: 0.6 }}>· {LANGUAGES[job.language]}</span>
              )}
            </span>
            {job.finished_at && !isActive && (
              <span style={{ color: 'var(--text-3)' }}>
                · {new Date(job.finished_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        )}
        <button onClick={handleRun} disabled={loading || isActive} style={{
          background: isActive ? 'var(--bg-card)' : 'var(--blue)', color: '#fff',
          padding: '6px 16px', fontSize: 13,
          border: `1px solid ${isActive ? 'var(--border)' : 'transparent'}`,
        }}>
          {isActive ? t('nav_running') : t('nav_run')}
        </button>
      </div>

      <style>{`@keyframes navpulse { 0%,100%{opacity:1} 50%{opacity:0.35} }`}</style>
    </nav>
  )
}
