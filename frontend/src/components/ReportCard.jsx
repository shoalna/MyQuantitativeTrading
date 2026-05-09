import { useState } from 'react'
import { useLang } from '../context/LangContext'

const SENTIMENT_STYLE = {
  bullish: { color: '#22c55e', bg: '#14532d22', border: '#22c55e44' },
  bearish: { color: '#ef4444', bg: '#7f1d1d22', border: '#ef444444' },
  neutral: { color: '#a1a1aa', bg: '#27272a44', border: '#52525b44' },
}

function ScoreGauge({ score, t }) {
  const pct = score != null ? ((score + 1) / 2) * 100 : 50
  const color = score == null ? '#52525b'
    : score > 0.2 ? '#22c55e' : score < -0.2 ? '#ef4444' : '#a1a1aa'
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>
        <span>{t('label_bearish')}</span>
        <span style={{ color, fontWeight: 600 }}>{score != null ? score.toFixed(2) : '—'}</span>
        <span>{t('label_bullish')}</span>
      </div>
      <div style={{
        position: 'relative', height: 6, borderRadius: 99, overflow: 'visible',
        background: 'linear-gradient(to right, #ef4444 0%, #52525b 50%, #22c55e 100%)', opacity: 0.85,
      }}>
        <div style={{
          position: 'absolute', top: '50%', left: `${pct}%`,
          transform: 'translate(-50%,-50%)',
          width: 14, height: 14, borderRadius: '50%',
          background: color, border: '2px solid var(--bg-card)',
          boxShadow: `0 0 8px ${color}88`, transition: 'left 0.4s ease',
        }} />
      </div>
    </div>
  )
}

function NewsSection({ articles, topNews, t }) {
  const list = articles?.length ? articles : []
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {list.map((a, i) => {
        const title = a.title_translated || a.title
        const snippet = a.snippet_translated || a.snippet
        return (
          <a key={a.id ?? i} href={a.url || '#'} target="_blank" rel="noreferrer"
            style={{
              display: 'block', padding: '12px 0',
              borderBottom: i < list.length - 1 ? '1px solid var(--border)' : 'none',
              textDecoration: 'none',
            }}>
            <div style={{
              fontSize: 13, fontWeight: 500, color: 'var(--text-1)', lineHeight: 1.4, marginBottom: 4,
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>{title}</div>
            <div style={{ display: 'flex', gap: 8, fontSize: 11, color: 'var(--text-3)' }}>
              {a.published_at && <span>{new Date(a.published_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>}
              {snippet && <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{snippet}</span>}
            </div>
          </a>
        )
      })}
      {list.length === 0 && topNews?.length > 0 && topNews.map((h, i) => (
        <div key={i} style={{ padding: '10px 0', borderBottom: i < topNews.length - 1 ? '1px solid var(--border)' : 'none', fontSize: 13, color: 'var(--text-2)' }}>{h}</div>
      ))}
      {list.length === 0 && !topNews?.length && (
        <div style={{ color: 'var(--text-3)', fontSize: 13, padding: '12px 0' }}>{t('no_news')}</div>
      )}
    </div>
  )
}

function CommunitySection({ community, t }) {
  const reddit = community?.reddit?.posts || []
  const youtube = community?.youtube?.videos || []
  if (!reddit.length && !youtube.length)
    return <div style={{ color: 'var(--text-3)', fontSize: 13, padding: '12px 0' }}>{t('no_community')}</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {reddit.map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
          <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: '#ff450018', color: '#ff6314', border: '1px solid #ff451430' }}>r/</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.4 }}>{p.title_translated || p.title}</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3 }}>▲ {p.score?.toLocaleString()}</div>
          </div>
        </div>
      ))}
      {youtube.map((v, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 0', borderBottom: i < youtube.length - 1 ? '1px solid var(--border)' : 'none' }}>
          <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: '#ff000018', color: '#ff4040', border: '1px solid #ff000030' }}>▶</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.4 }}>{v.title_translated || v.title}</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3 }}>{v.views?.toLocaleString()} views</div>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function ReportCard({ report }) {
  const { t } = useLang()
  const [tab, setTab] = useState('news')
  const [hover, setHover] = useState(false)
  const { ticker, sentiment_score, sentiment_label, summary, top_news, community, articles } = report
  const s = SENTIMENT_STYLE[sentiment_label] || SENTIMENT_STYLE.neutral
  const sentLabel = t(`sent_${sentiment_label || 'neutral'}`)

  const TABS = [['news', t('tab_news')], ['community', t('tab_community')]]

  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{
      background: hover ? 'var(--bg-card-h)' : 'var(--bg-card)',
      border: `1px solid ${hover ? 'var(--border-h)' : 'var(--border)'}`,
      borderRadius: 'var(--r)', overflow: 'hidden',
      transition: 'background var(--ease), border-color var(--ease), box-shadow var(--ease)',
      boxShadow: hover ? '0 8px 32px rgba(0,0,0,0.4)' : '0 2px 8px rgba(0,0,0,0.2)',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ height: 3, background: `linear-gradient(90deg, ${s.color}99, ${s.color}11)` }} />

      {/* Header */}
      <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, flexShrink: 0,
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700, color: 'var(--text-3)',
          }}>#{ticker.rank}</div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1 }}>{ticker.symbol}</div>
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>{ticker.company || '—'}</div>
          </div>
        </div>
        <div style={{
          padding: '5px 12px', borderRadius: 99,
          background: s.bg, border: `1px solid ${s.border}`,
          fontSize: 12, fontWeight: 600, color: s.color, whiteSpace: 'nowrap',
        }}>{sentLabel}</div>
      </div>

      {/* Mention badge */}
      <div style={{ padding: '0 20px 14px' }}>
        <span style={{
          fontSize: 11, color: 'var(--text-3)', background: 'var(--bg-surface)',
          border: '1px solid var(--border)', borderRadius: 99, padding: '2px 10px',
        }}>{ticker.mention_count} {t('mentions')}</span>
      </div>

      {/* Score gauge */}
      <div style={{ padding: '0 20px 16px' }}>
        <ScoreGauge score={sentiment_score} t={t} />
      </div>

      {/* Summary */}
      {summary && summary !== 'Anthropic API key not configured.' && (
        <div style={{
          margin: '0 20px 16px', padding: '12px 14px',
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--r-sm)', fontSize: 13, color: 'var(--text-2)',
          lineHeight: 1.65, fontStyle: 'italic',
        }}>{summary}</div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', borderTop: '1px solid var(--border)', padding: '0 20px' }}>
        {TABS.map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            background: 'transparent',
            color: tab === key ? 'var(--text-1)' : 'var(--text-3)',
            borderRadius: 0, padding: '10px 14px 9px', fontSize: 12,
            fontWeight: tab === key ? 600 : 400,
            borderBottom: tab === key ? '2px solid var(--blue)' : '2px solid transparent',
            marginBottom: -1,
            transition: 'color var(--ease), border-color var(--ease)',
          }}>
            {label}
            {key === 'news' && articles?.length > 0 && (
              <span style={{
                marginLeft: 5, fontSize: 10, fontWeight: 600,
                background: 'var(--bg-surface)', border: '1px solid var(--border)',
                borderRadius: 99, padding: '1px 6px', color: 'var(--text-3)',
              }}>{articles.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ padding: '4px 20px 16px', flex: 1 }}>
        {tab === 'news' && <NewsSection articles={articles} topNews={top_news} t={t} />}
        {tab === 'community' && <CommunitySection community={community} t={t} />}
      </div>
    </div>
  )
}
