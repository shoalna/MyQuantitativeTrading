import { useState, useEffect } from 'react'
import { getJobs, getReports } from '../api/client'
import { useLang } from '../context/LangContext'
import ReportCard from './ReportCard'

function StatPill({ label, value, color }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '10px 20px',
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 'var(--r-sm)', gap: 2, minWidth: 80,
    }}>
      <span style={{ fontSize: 20, fontWeight: 800, color: color || 'var(--text-1)' }}>{value}</span>
      <span style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{label}</span>
    </div>
  )
}

function EmptyState({ t }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '80px 20px', textAlign: 'center', gap: 16,
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: 16,
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24,
      }}>◆</div>
      <div>
        <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 6 }}>{t('empty_title')}</div>
        <div style={{ fontSize: 13, color: 'var(--text-2)', maxWidth: 340 }}>{t('empty_body')}</div>
      </div>
    </div>
  )
}

export default function Dashboard({ refreshTrigger }) {
  const { lang, t } = useLang()
  const [reports, setReports] = useState([])
  const [job, setJob] = useState(null)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const { data: jobs } = await getJobs()
      const done = jobs.find((j) => j.status === 'done' && j.language === lang)
             ?? jobs.find((j) => j.status === 'done')
      if (!done) { setReports([]); setJob(null); return }
      setJob(done)
      const { data } = await getReports(done.id)
      setReports(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [refreshTrigger, lang])

  const bullish = reports.filter((r) => r.sentiment_label === 'bullish').length
  const bearish = reports.filter((r) => r.sentiment_label === 'bearish').length
  const neutral  = reports.filter((r) => r.sentiment_label === 'neutral').length

  return (
    <main style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 4 }}>
          {t('page_title')}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-2)' }}>
          {job
            ? `${t('last_analysis')} · Job #${job.id} · ${new Date(job.finished_at).toLocaleString()}`
            : t('no_run_yet')}
          {loading && ` · ${t('loading')}`}
        </p>
      </div>

      {reports.length > 0 && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 28, flexWrap: 'wrap' }}>
          <StatPill label={t('stat_tickers')} value={reports.length} />
          <StatPill label={t('stat_bullish')} value={bullish} color="#22c55e" />
          <StatPill label={t('stat_bearish')} value={bearish} color="#ef4444" />
          <StatPill label={t('stat_neutral')} value={neutral} color="#a1a1aa" />
          {reports[0] && (
            <StatPill
              label={t('stat_top')}
              value={`${reports[0].ticker.symbol} (${reports[0].ticker.mention_count})`}
              color="var(--blue)"
            />
          )}
        </div>
      )}

      {reports.length === 0 && !loading ? (
        <EmptyState t={t} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 20 }}>
          {reports.map((r) => <ReportCard key={r.ticker.id} report={r} />)}
        </div>
      )}
    </main>
  )
}
