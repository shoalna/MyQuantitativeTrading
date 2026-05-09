import { useState, useEffect } from 'react'
import { getCompany } from '../api/client'
import { useLang } from '../context/LangContext'

const PRED_COLOR = { buy: '#22c55e', sell: '#ef4444', hold: '#f59e0b' }
const PRED_BG    = { buy: '#14532d22', sell: '#7f1d1d22', hold: '#78350f22' }
const SENT_COLOR = { bullish: '#22c55e', bearish: '#ef4444', neutral: '#a1a1aa' }
const SENT_BG    = { bullish: '#14532d22', bearish: '#7f1d1d22', neutral: '#27272a44' }

/* ── ML Score line chart ─────────────────────────────────────── */
function MlChart({ history }) {
  if (!history?.length) return null
  const W = 800, H = 110
  const pl = 4, pr = 4, pt = 8, pb = 4
  const iw = W - pl - pr, ih = H - pt - pb
  const n = history.length

  const toX = (i) => pl + (i / (n - 1)) * iw
  const toY = (s) => pt + (1 - s) * ih

  const pts = history.map((h, i) => [toX(i), toY(h.score)])
  const lineD = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const fillD = lineD + ` L${toX(n - 1).toFixed(1)},${H} L${pl},${H} Z`

  const lastScore = history[n - 1].score
  const color = lastScore > 0.5 ? '#22c55e' : '#ef4444'
  const neutralY = toY(0.5).toFixed(1)
  const [lx, ly] = pts[n - 1]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }} preserveAspectRatio="none">
      <line x1={pl} y1={neutralY} x2={W - pr} y2={neutralY}
        stroke="#3f3f46" strokeWidth="1" strokeDasharray="6,5" />
      <path d={fillD} fill={`${color}18`} />
      <path d={lineD} fill="none" stroke={color} strokeWidth="2"
        strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx.toFixed(1)} cy={ly.toFixed(1)} r="5" fill={color}
        style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
    </svg>
  )
}

/* ── Section wrapper ─────────────────────────────────────────── */
function Section({ title, children }) {
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 'var(--r)', overflow: 'hidden', marginBottom: 20,
    }}>
      <div style={{
        padding: '12px 20px', borderBottom: '1px solid var(--border)',
        fontSize: 11, fontWeight: 700, color: 'var(--text-3)',
        textTransform: 'uppercase', letterSpacing: '0.07em',
      }}>{title}</div>
      <div style={{ padding: '16px 20px' }}>{children}</div>
    </div>
  )
}

/* ── News list ───────────────────────────────────────────────── */
function NewsList({ articles, t }) {
  if (!articles?.length)
    return <div style={{ color: 'var(--text-3)', fontSize: 13 }}>{t('no_news')}</div>
  return (
    <div>
      {articles.map((a, i) => (
        <a key={i} href={a.url || '#'} target="_blank" rel="noreferrer" style={{
          display: 'block', padding: '12px 0',
          borderBottom: i < articles.length - 1 ? '1px solid var(--border)' : 'none',
          textDecoration: 'none',
        }}>
          <div style={{
            fontSize: 14, fontWeight: 500, color: 'var(--text-1)', lineHeight: 1.45,
            marginBottom: 5,
            display: '-webkit-box', WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>{a.title_translated || a.title}</div>
          <div style={{ display: 'flex', gap: 10, fontSize: 11, color: 'var(--text-3)' }}>
            {a.source && a.source !== 'stub' && (
              <span style={{ flexShrink: 0, fontWeight: 600 }}>{a.source}</span>
            )}
            {a.published_at && (
              <span>{new Date(a.published_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
            )}
            {(a.snippet_translated || a.snippet) && (
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {a.snippet_translated || a.snippet}
              </span>
            )}
          </div>
        </a>
      ))}
    </div>
  )
}

/* ── SNS section ─────────────────────────────────────────────── */
function SnsList({ sns, t }) {
  const posts  = sns?.reddit?.posts   || []
  const videos = sns?.youtube?.videos || []
  if (!posts.length && !videos.length)
    return <div style={{ color: 'var(--text-3)', fontSize: 13 }}>{t('no_community')}</div>
  return (
    <div>
      {posts.map((p, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'flex-start', gap: 12,
          padding: '12px 0',
          borderBottom: '1px solid var(--border)',
        }}>
          <span style={{
            flexShrink: 0, fontSize: 10, fontWeight: 700,
            padding: '2px 7px', borderRadius: 99,
            background: '#ff450018', color: '#ff6314', border: '1px solid #ff451430',
          }}>r/</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.4 }}>{p.title}</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3 }}>▲ {p.score?.toLocaleString()}</div>
          </div>
        </div>
      ))}
      {videos.map((v, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'flex-start', gap: 12,
          padding: '12px 0',
          borderBottom: i < videos.length - 1 ? '1px solid var(--border)' : 'none',
        }}>
          <span style={{
            flexShrink: 0, fontSize: 10, fontWeight: 700,
            padding: '2px 7px', borderRadius: 99,
            background: '#ff000018', color: '#ff4040', border: '1px solid #ff000030',
          }}>▶</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.4 }}>{v.title}</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3 }}>{v.views?.toLocaleString()} views</div>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ── Main component ──────────────────────────────────────────── */
export default function CompanyDetail({ symbol, onBack }) {
  const { lang, t } = useLang()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('overview')

  useEffect(() => {
    setLoading(true)
    getCompany(symbol, lang)
      .then(({ data: d }) => setData(d))
      .finally(() => setLoading(false))
  }, [symbol, lang])

  if (loading) return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: '60px 24px', textAlign: 'center', color: 'var(--text-3)' }}>
      {t('loading')}
    </main>
  )
  if (!data) return null

  const ml = data.ml_scoring
  const predColor = PRED_COLOR[ml.prediction] || '#a1a1aa'
  const predLabel = t(`ml_${ml.prediction}`) || ml.prediction.toUpperCase()
  const TABS = [
    ['overview', t('tab_overview')],
    ['news',     t('tab_news')],
    ['sns',      t('tab_community')],
  ]

  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px' }}>
      {/* Back button */}
      <button onClick={onBack} style={{
        background: 'transparent', color: 'var(--text-3)',
        border: 'none', padding: '0 0 20px', fontSize: 13,
        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
      }}>{t('detail_back')}</button>

      {/* Company header */}
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 'var(--r)', padding: '20px 24px', marginBottom: 20,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 14, flexShrink: 0,
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 700, color: 'var(--text-3)',
          }}>{data.symbol.slice(0, 4)}</div>
          <div>
            <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1 }}>
              {data.name}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>
              {data.symbol} · {data.country} · {data.industry}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            padding: '6px 16px', borderRadius: 99, fontWeight: 700, fontSize: 14,
            color: predColor, background: PRED_BG[ml.prediction] || '#27272a44',
            border: `1px solid ${predColor}44`,
          }}>{predLabel}</div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: predColor }}>{ml.score.toFixed(2)}</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{t('ml_confidence')} {Math.round(ml.confidence * 100)}%</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex', gap: 2,
        borderBottom: '1px solid var(--border)', marginBottom: 20,
      }}>
        {TABS.map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            background: 'transparent',
            color: tab === key ? 'var(--text-1)' : 'var(--text-3)',
            borderRadius: 0,
            padding: '10px 18px 9px', fontSize: 13,
            fontWeight: tab === key ? 600 : 400,
            borderBottom: tab === key ? '2px solid var(--blue)' : '2px solid transparent',
            marginBottom: -1,
            transition: 'color var(--ease), border-color var(--ease)',
          }}>{label}</button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'overview' && (
        <Section title={t('ml_section')}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>
              <span>0.0</span>
              <span style={{ fontWeight: 600 }}>{t('ml_history')}</span>
              <span>1.0</span>
            </div>
            <div style={{
              background: 'var(--bg-surface)', border: '1px solid var(--border)',
              borderRadius: 'var(--r-sm)', padding: '12px 8px 4px', overflow: 'hidden',
            }}>
              <MlChart history={ml.history} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>
              <span>{ml.history[0]?.date}</span>
              <span>{ml.history[ml.history.length - 1]?.date}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
            {[
              { label: t('ml_prediction'), value: predLabel, color: predColor },
              { label: t('ml_confidence'), value: `${Math.round(ml.confidence * 100)}%`, color: 'var(--text-1)' },
              { label: t('col_score'), value: ml.score.toFixed(2), color: predColor },
            ].map(({ label, value, color }) => (
              <div key={label} style={{
                flex: 1, minWidth: 100,
                background: 'var(--bg-surface)', border: '1px solid var(--border)',
                borderRadius: 'var(--r-sm)', padding: '10px 14px',
              }}>
                <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color }}>{value}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {tab === 'news' && (
        <Section title={t('detail_news')}>
          <NewsList articles={data.news} t={t} />
        </Section>
      )}

      {tab === 'sns' && (
        <Section title={t('detail_sns')}>
          <SnsList sns={data.sns} t={t} />
        </Section>
      )}
    </main>
  )
}
