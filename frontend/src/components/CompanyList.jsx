import { useState, useEffect } from 'react'
import { getCompanies } from '../api/client'
import { useLang } from '../context/LangContext'

const SENT_COLOR = { bullish: '#22c55e', bearish: '#ef4444', neutral: '#a1a1aa' }
const SENT_BG    = { bullish: '#14532d22', bearish: '#7f1d1d22', neutral: '#27272a44' }

function AttitudeBadge({ value, t }) {
  const label = t(`att_${value}`) || value
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600,
      color: SENT_COLOR[value] || '#a1a1aa',
      background: SENT_BG[value] || '#27272a44',
      border: `1px solid ${SENT_COLOR[value] || '#52525b'}44`,
      whiteSpace: 'nowrap',
    }}>{label}</span>
  )
}

function ScoreBar({ score }) {
  const color = score > 0.55 ? '#22c55e' : score < 0.45 ? '#ef4444' : '#a1a1aa'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 56, height: 4, borderRadius: 99, background: 'var(--bg-surface)', overflow: 'hidden' }}>
        <div style={{ width: `${score * 100}%`, height: '100%', background: color, borderRadius: 99 }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color, minWidth: 32 }}>{score.toFixed(2)}</span>
    </div>
  )
}

function CompanyRow({ company, onSelect, t }) {
  const [hover, setHover] = useState(false)
  return (
    <div
      onClick={() => onSelect(company.symbol)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'grid',
        gridTemplateColumns: '2fr 1.2fr 1fr 1fr 1.2fr 24px',
        alignItems: 'center', gap: 12,
        padding: '14px 20px',
        borderBottom: '1px solid var(--border)',
        cursor: 'pointer',
        background: hover ? 'var(--bg-card-h)' : 'transparent',
        transition: 'background var(--ease)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 38, height: 38, borderRadius: 10, flexShrink: 0,
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, fontWeight: 700, color: 'var(--text-3)',
        }}>{company.symbol.slice(0, 4)}</div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.2 }}>{company.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{company.symbol} · {company.country}</div>
        </div>
      </div>
      <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{company.industry}</span>
      <AttitudeBadge value={company.news_attitude} t={t} />
      <AttitudeBadge value={company.sns_attitude} t={t} />
      <ScoreBar score={company.score} />
      <span style={{ color: hover ? 'var(--text-1)' : 'var(--text-3)', fontSize: 18, textAlign: 'right' }}>›</span>
    </div>
  )
}

export default function CompanyList({ onSelect }) {
  const { t } = useLang()
  const [companies, setCompanies] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getCompanies()
      .then(({ data }) => setCompanies(data))
      .finally(() => setLoading(false))
  }, [])

  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 4 }}>
          {t('nav_home')}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-2)' }}>{t('watchlist_subtitle')}</p>
      </div>

      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 'var(--r)', overflow: 'hidden',
      }}>
        {/* Column header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1.2fr 1fr 1fr 1.2fr 24px',
          gap: 12, padding: '10px 20px',
          borderBottom: '1px solid var(--border)',
          fontSize: 10, fontWeight: 700, color: 'var(--text-3)',
          textTransform: 'uppercase', letterSpacing: '0.07em',
        }}>
          <span>{t('col_company')}</span>
          <span>{t('col_industry')}</span>
          <span>{t('col_news_att')}</span>
          <span>{t('col_sns_att')}</span>
          <span>{t('col_score')}</span>
          <span />
        </div>

        {loading && (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
            {t('loading')}
          </div>
        )}

        {!loading && companies.length === 0 && (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
            {t('empty_companies')}
          </div>
        )}

        {companies.map((c) => (
          <CompanyRow key={c.symbol} company={c} onSelect={onSelect} t={t} />
        ))}
      </div>
    </main>
  )
}
