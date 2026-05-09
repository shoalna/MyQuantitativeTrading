import { useState, useEffect, useCallback } from 'react'
import { getJpStockDetail, refreshJpStock } from '../api/client'
import { useLang } from '../context/LangContext'

// ── Candlestick chart ─────────────────────────────────────────────────────────

function CandlestickChart({ data }) {
  const CANDLE_W  = 8
  const CANDLE_G  = 2
  const STEP      = CANDLE_W + CANDLE_G
  const PAD_L     = 58
  const PAD_R     = 10
  const PAD_T     = 10
  const PAD_B     = 28
  const H         = 260

  const valid = data.filter(d => d.high != null && d.low != null && d.close != null)
  if (valid.length < 3) {
    return <div style={{ padding: 24, color: 'var(--text-3)', fontSize: 13 }}>チャートデータなし</div>
  }

  const width = PAD_L + valid.length * STEP + PAD_R
  const plotH = H - PAD_T - PAD_B
  const minP  = Math.min(...valid.map(d => d.low))
  const maxP  = Math.max(...valid.map(d => d.high))
  const range = maxP - minP || 1
  const py    = v => PAD_T + (1 - (v - minP) / range) * plotH

  const yTicks   = [0, 0.25, 0.5, 0.75, 1].map(r => minP + range * r)
  const xStep    = Math.max(1, Math.floor(valid.length / 8))
  const xLabels  = valid.filter((_, i) => i % xStep === 0 || i === valid.length - 1)

  return (
    <div style={{ overflowX: 'auto', overflowY: 'hidden', background: 'var(--bg-surface)', borderRadius: 'var(--r-sm)' }}>
      <svg width={width} height={H} style={{ display: 'block' }}>
        {/* Y grid + labels */}
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={PAD_L} y1={py(v)} x2={width - PAD_R} y2={py(v)}
              stroke="var(--border)" strokeWidth={0.5} />
            <text x={PAD_L - 5} y={py(v) + 4} textAnchor="end" fontSize={10} fill="var(--text-3)">
              {v >= 10000 ? `${(v / 1000).toFixed(0)}k` : v >= 1000 ? v.toLocaleString('ja-JP', { maximumFractionDigits: 0 }) : v.toFixed(1)}
            </text>
          </g>
        ))}

        {/* Candles */}
        {valid.map((d, i) => {
          const open   = d.open  ?? d.close
          const isUp   = d.close >= open
          const color  = isUp ? '#22c55e' : '#ef4444'
          const cx     = PAD_L + i * STEP + CANDLE_W / 2
          const bTop   = py(Math.max(open, d.close))
          const bBot   = py(Math.min(open, d.close))
          const bH     = Math.max(1, bBot - bTop)
          return (
            <g key={d.date}>
              <line x1={cx} y1={py(d.high)} x2={cx} y2={py(d.low)} stroke={color} strokeWidth={1} />
              <rect x={cx - CANDLE_W / 2} y={bTop} width={CANDLE_W} height={bH} fill={color} />
            </g>
          )
        })}

        {/* X-axis labels */}
        {xLabels.map((d, li) => {
          const i  = valid.indexOf(d)
          const cx = PAD_L + i * STEP + CANDLE_W / 2
          return (
            <text key={li} x={cx} y={H - 6} textAnchor="middle" fontSize={9} fill="var(--text-3)">
              {d.date.slice(5)}
            </text>
          )
        })}
      </svg>
    </div>
  )
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ icon, title, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        borderBottom: '1px solid var(--border)', paddingBottom: 8, marginBottom: 12,
      }}>
        <span style={{ fontSize: 16 }}>{icon}</span>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{title}</h2>
      </div>
      {children}
    </div>
  )
}

// ── No-content placeholder ────────────────────────────────────────────────────

function NoContent({ label }) {
  return (
    <div style={{
      padding: '20px 16px', borderRadius: 'var(--r-sm)',
      background: 'var(--bg-surface)', border: '1px dashed var(--border)',
      color: 'var(--text-3)', fontSize: 13, textAlign: 'center',
    }}>
      {label}
    </div>
  )
}

// ── Main detail component ─────────────────────────────────────────────────────

export default function JapanStockDetail({ code, onBack }) {
  const { t } = useLang()
  const [detail, setDetail]       = useState(null)
  const [loading, setLoading]     = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError]         = useState(null)

  const fetchDetail = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data } = await getJpStockDetail(code)
      setDetail(data)
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [code])

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      const { data } = await refreshJpStock(code)
      setDetail(data)
    } catch (e) {
      console.error('Refresh failed:', e)
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => { fetchDetail() }, [fetchDetail])

  // ── Loading / error states ──────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)' }}>
        {t('loading')}
      </div>
    )
  }
  if (error || !detail) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <div style={{ color: 'var(--red)', marginBottom: 12 }}>{error || 'Error'}</div>
        <button onClick={onBack}>{t('jp_detail_back')}</button>
      </div>
    )
  }

  // ── Data prep ───────────────────────────────────────────────────────────────

  const change    = detail.change_6m
  const absChange = detail.abs_change_6m
  const isApprox  = detail.change_months != null && detail.change_months < 6
  const posColor  = v => v == null ? 'var(--text-3)' : v >= 0 ? 'var(--green)' : 'var(--red)'

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '16px 20px' }}>

      {/* ── Top bar ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 12 }}>
        <button
          onClick={onBack}
          style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-2)', padding: '6px 14px', flexShrink: 0 }}
        >
          {t('jp_detail_back')}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {detail.price_updated_at && (
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
              {t('jp_detail_updated')}: {new Date(detail.price_updated_at).toLocaleDateString()}
            </span>
          )}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            style={{ background: 'var(--blue)', color: '#fff', border: 'none', padding: '6px 14px', fontSize: 13 }}
          >
            {refreshing ? '更新中…' : t('jp_detail_refresh')}
          </button>
        </div>
      </div>

      {/* ── Company header ── */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{detail.name}</h1>
          <span style={{ fontSize: 13, fontFamily: 'monospace', color: 'var(--blue)' }}>{detail.code}</span>
        </div>
        {detail.name_en && detail.name_en !== detail.name && (
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 2 }}>{detail.name_en}</div>
        )}
        <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>
          {[detail.market, detail.sector].filter(Boolean).join(' / ')}
        </div>

        {/* Price + change row */}
        <div style={{ display: 'flex', gap: 20, marginTop: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
          <span style={{ fontSize: 24, fontWeight: 700, fontFamily: 'monospace' }}>
            {detail.current_price != null
              ? `¥${Number(detail.current_price).toLocaleString('ja-JP')}`
              : '—'}
          </span>
          {change != null && (
            <span style={{ color: posColor(change), fontWeight: 600, fontSize: 15 }}>
              {change >= 0 ? '+' : ''}{Number(change).toFixed(2)}%
            </span>
          )}
          {absChange != null && (
            <span style={{ color: posColor(absChange), fontWeight: 600, fontSize: 15, fontFamily: 'monospace' }}>
              {absChange >= 0 ? '+' : ''}¥{Number(absChange).toLocaleString('ja-JP', { maximumFractionDigits: 0 })}
              {isApprox && (
                <span
                  title={t('jp_approx_data').replace('{n}', detail.change_months)}
                  style={{ marginLeft: 4, fontSize: 12, color: 'var(--amber)' }}
                >⚠</span>
              )}
            </span>
          )}
        </div>
      </div>

      {/* ── Daily chart ── */}
      <Section icon="📈" title={t('jp_detail_daily')}>
        {detail.daily_prices?.length > 0
          ? <CandlestickChart data={detail.daily_prices} />
          : <NoContent label={t('jp_detail_no_content')} />}
      </Section>

      {/* ── Wikipedia ── */}
      <Section icon="📖" title={t('jp_detail_wiki')}>
        {detail.wikipedia?.found && detail.wikipedia.extract ? (
          <div>
            <div style={{
              maxHeight: 280, overflowY: 'auto',
              fontSize: 13, lineHeight: 1.75, color: 'var(--text-1)',
              background: 'var(--bg-surface)', padding: '12px 16px',
              borderRadius: 'var(--r-sm)', border: '1px solid var(--border)',
              whiteSpace: 'pre-wrap',
            }}>
              {detail.wikipedia.extract}
            </div>
            {detail.wikipedia.url && (
              <a
                href={detail.wikipedia.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 12, color: 'var(--blue)', marginTop: 8, display: 'inline-block' }}
              >
                Wikipedia で全文を読む →
              </a>
            )}
          </div>
        ) : (
          <NoContent label={t('jp_detail_no_content')} />
        )}
      </Section>

      {/* ── Placeholder sections ── */}
      {[
        { icon: '📊', key: 'jp_detail_shikiho' },
        { icon: '📰', key: 'jp_detail_news'    },
        { icon: '▶',  key: 'jp_detail_youtube' },
        { icon: '💬', key: 'jp_detail_sns'     },
      ].map(({ icon, key }) => (
        <Section key={key} icon={icon} title={t(key)}>
          <NoContent label={t('jp_detail_no_content')} />
        </Section>
      ))}

    </div>
  )
}
