import { useState, useEffect, useCallback, Fragment } from 'react'
import { getJpStockDetail, refreshJpStock, fetchJpCompanyInfo, fetchJpYoutubeReport } from '../api/client'
import { useLang } from '../context/LangContext'
import katex from 'katex'

// ── Minimal Markdown + KaTeX renderer ────────────────────────────────────────

function KatexInline({ latex }) {
  let html = ''
  try { html = katex.renderToString(latex, { throwOnError: false, displayMode: false }) }
  catch { html = latex }
  return <span dangerouslySetInnerHTML={{ __html: html }} />
}

function KatexBlock({ latex }) {
  let html = ''
  try { html = katex.renderToString(latex, { throwOnError: false, displayMode: true }) }
  catch { html = latex }
  return (
    <div style={{ overflowX: 'auto', padding: '10px 0', textAlign: 'center' }}
      dangerouslySetInnerHTML={{ __html: html }} />
  )
}

function InlineText({ text }) {
  const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`|\$[^$]+\$)/)
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**'))
      return <strong key={i}>{p.slice(2, -2)}</strong>
    if (p.startsWith('`') && p.endsWith('`'))
      return (
        <code key={i} style={{
          fontFamily: 'monospace', fontSize: '0.88em',
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          padding: '1px 5px', borderRadius: 3, color: 'var(--blue)',
        }}>{p.slice(1, -1)}</code>
      )
    if (p.startsWith('$') && p.endsWith('$') && p.length > 2)
      return <KatexInline key={i} latex={p.slice(1, -1)} />
    return <Fragment key={i}>{p}</Fragment>
  })
}

function MarkdownReport({ text }) {
  if (!text) return null
  const lines = text.split('\n')
  const els = []
  let listBuf = []
  let mathBuf = null

  const flushList = () => {
    if (!listBuf.length) return
    els.push(
      <ul key={`ul-${els.length}`} style={{ margin: '4px 0 10px', paddingLeft: 20, fontSize: 13, lineHeight: 1.9, color: 'var(--text-1)' }}>
        {listBuf.map((li, i) => <li key={i}><InlineText text={li} /></li>)}
      </ul>
    )
    listBuf = []
  }

  lines.forEach((raw, i) => {
    const line = raw.trimEnd()

    if (line === '$$') {
      if (mathBuf === null) {
        flushList()
        mathBuf = []
      } else {
        els.push(
          <div key={`math-${i}`} style={{
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--r-sm)', margin: '8px 0', padding: '4px 8px',
          }}>
            <KatexBlock latex={mathBuf.join('\\\\')} />
          </div>
        )
        mathBuf = null
      }
      return
    }
    if (mathBuf !== null) { mathBuf.push(line); return }

    if (line === '---') {
      flushList()
      els.push(<hr key={i} style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '18px 0 14px' }} />)
    } else if (line.startsWith('#### ')) {
      flushList()
      els.push(<h4 key={i} style={{ fontSize: 12, fontWeight: 700, margin: '10px 0 2px', color: 'var(--text-2)' }}><InlineText text={line.slice(5)} /></h4>)
    } else if (line.startsWith('### ')) {
      flushList()
      els.push(<h3 key={i} style={{ fontSize: 13, fontWeight: 700, margin: '14px 0 4px', color: 'var(--text-1)', paddingBottom: 2, borderBottom: '1px solid var(--border)' }}><InlineText text={line.slice(4)} /></h3>)
    } else if (line.startsWith('## ')) {
      flushList()
      els.push(<h2 key={i} style={{ fontSize: 15, fontWeight: 700, margin: '20px 0 6px', color: 'var(--text-1)' }}><InlineText text={line.slice(3)} /></h2>)
    } else if (line.startsWith('# ')) {
      flushList()
      els.push(<h1 key={i} style={{ fontSize: 17, fontWeight: 800, margin: '0 0 14px', color: 'var(--text-1)' }}><InlineText text={line.slice(2)} /></h1>)
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      listBuf.push(line.slice(2))
    } else if (line === '') {
      flushList()
      els.push(<div key={i} style={{ height: 6 }} />)
    } else {
      flushList()
      els.push(<p key={i} style={{ fontSize: 13, lineHeight: 1.9, margin: '2px 0', color: 'var(--text-1)' }}><InlineText text={line} /></p>)
    }
  })
  flushList()
  return <div style={{ padding: '12px 16px' }}>{els}</div>
}

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

function Section({ icon, title, headerRight, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        borderBottom: '1px solid var(--border)', paddingBottom: 8, marginBottom: 12,
      }}>
        <span style={{ fontSize: 16 }}>{icon}</span>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{title}</h2>
        {headerRight && <div style={{ marginLeft: 'auto' }}>{headerRight}</div>}
      </div>
      {children}
    </div>
  )
}

// ── Strategy info modal ───────────────────────────────────────────────────────

const STRAT_INFO_MD = `# Score Computation Reference

All scores are **0 – 100** percentile ranks, recomputed when "AQR Scores" is triggered. Higher = stronger signal. Short-period variants (3D, 5D) require full daily price history and may show **—** for stocks not yet individually opened.

---

## 1. TSMOM — Time-Series Momentum

**Idea:** A stock that has been rising tends to keep rising. TSMOM measures a stock's own past return and ranks it against all other stocks — the higher the rank, the stronger the uptrend.

### TSMOM 6M

**Data:** 7 monthly end-of-day snapshots from the database.

**Step 1 — Compute each month's percent return** (how much did the price move month-over-month, 6 times):
$$
r_i = \\frac{P_i - P_{i-1}}{P_{i-1}} \\times 100 \\quad (i = 1 \\ldots 6)
$$

**Step 2 — Average the 6 monthly returns, then rank across all stocks** (top = 100, bottom = 0):
$$
\\bar{r} = \\frac{1}{6}\\sum_{i=1}^{6} r_i \\qquad \\text{score} = \\text{PERCENT\\_RANK}(\\bar{r}) \\times 100
$$

**Signal:** $\\text{score} > 50$ → Uptrend &nbsp;|&nbsp; $\\text{score} < 50$ → Downtrend

### TSMOM 1M / 5D / 3D

**Data:** 90-day rolling daily prices fetched when the detail page is opened.

**Step 1 — Compute return over the lookback window** ($n$ = 21 days for 1M, 5 for 5D, 3 for 3D):
$$
\\text{Return}(n) = \\frac{P_0 - P_{-n}}{P_{-n}} \\times 100
$$

**Step 2 — Rank this return across all stocks** (same percentile logic as 6M):
$$
\\text{score} = \\text{PERCENT\\_RANK}(\\text{Return}) \\times 100
$$

**Signal:** $\\text{score} > 50$ → Uptrend &nbsp;|&nbsp; $\\text{score} < 50$ → Downtrend

---

## 2. RSI(2) — 2-Period Wilder RSI

**Idea:** Prices cannot go up forever. RSI(2) is a short-term mean-reversion signal — if the stock has fallen sharply in the last 2 days, it is likely oversold and due for a bounce.

**Step 1 — Daily price change** (positive = up day, negative = down day):
$$
d_t = P_t - P_{t-1}
$$

**Step 2 — Split into gains and losses** (each is always $\\geq 0$):
$$
U_t = \\max(d_t,\\, 0) \\qquad D_t = \\max(-d_t,\\, 0)
$$

**Step 3 — Seed the smoother** using the simple average of the first 2 bars (starting point for the running average):
$$
\\bar{U}_0 = \\frac{U_1 + U_2}{2} \\qquad \\bar{D}_0 = \\frac{D_1 + D_2}{2}
$$

**Step 4 — Wilder smoothing** (exponential average that gives more weight to recent bars, $n = 2$):
$$
\\bar{U}_t = \\frac{\\bar{U}_{t-1} \\cdot (n-1) + U_t}{n} \\qquad \\bar{D}_t = \\frac{\\bar{D}_{t-1} \\cdot (n-1) + D_t}{n}
$$

**Step 5 — Convert to RSI** (ratio of average gain to average gain+loss, scaled to 0–100):
$$
\\text{RSI} = 100 - \\frac{100}{1 + \\bar{U}/\\bar{D}}
$$

If all recent moves were gains ($\\bar{D} = 0$), RSI = 100; if all losses ($\\bar{U} = 0$), RSI = 0.

**Signal:** $\\text{RSI} < 15$ → Oversold — likely bounce &nbsp;|&nbsp; $\\text{RSI} > 85$ → Overbought — likely pullback &nbsp;|&nbsp; otherwise Neutral

---

## 3. BB Squeeze — Bollinger Band Width Compression

**Idea:** Periods of unusually low volatility (a "squeeze") often precede sharp breakouts. This score measures how compressed the bands are right now compared to the last 30 bars. Score 100 = tightest squeeze recently seen.

**Step 1 — 3-bar average price and spread** (how much prices varied in the last 3 days):
$$
\\text{SMA}_3(t) = \\frac{P_t + P_{t-1} + P_{t-2}}{3}
$$
$$
\\text{STD}_3(t) = \\sqrt{\\frac{\\sum_{k=0}^{2}\\bigl(P_{t-k} - \\text{SMA}_3\\bigr)^2}{3}}
$$

**Step 2 — Band width as a percentage of price** (dividing by SMA makes it comparable across stocks at different price levels):
$$
\\text{BW}(t) = \\frac{4 \\times \\text{STD}_3(t)}{\\text{SMA}_3(t)} \\times 100
$$

**Step 3 — Rank today's width within the last 30 bars** (inverted so narrow = high score; 100 = tightest, 0 = widest):
$$
\\text{score} = \\left(1 - \\frac{\\text{BW} - \\text{BW}_{\\min}}{\\text{BW}_{\\max} - \\text{BW}_{\\min}}\\right) \\times 100
$$

If volatility has been completely flat over 30 bars ($\\text{BW}_{\\max} = \\text{BW}_{\\min}$), score defaults to 50.

**Signal:** $\\text{score} \\geq 75$ → Squeeze — watch for breakout &nbsp;|&nbsp; $< 75$ → Normal volatility

---

## 4. Pair Trade — Sector Deviation Z-Score

**Idea:** Compare each stock's return to the average of its sector peers. A stock scoring high is outperforming its own sector — useful for long/short pair trades within the same sector. Requires $\\geq 5$ stocks per sector.

**Step 1 — Compute sector average and standard deviation** (the "baseline" and "spread" of returns for the stock's peers):
$$
\\mu_s = \\frac{1}{N}\\sum_{i \\in s} r_i \\qquad \\sigma_s = \\sqrt{\\frac{\\sum_{i \\in s}(r_i - \\mu_s)^2}{N - 1}}
$$

**Step 2 — Z-score: how many standard deviations above/below the sector average?** Then clamp to [0, 100] so that $z = 0$ (in-line with sector) maps to 50, $z = +3$ (far outperform) maps to 100:
$$
z_i = \\frac{r_i - \\mu_s}{\\sigma_s} \\qquad \\text{score} = \\text{clamp}\\!\\left(\\frac{z_i + 3}{6} \\times 100,\\ 0,\\ 100\\right)
$$

**Return used per variant** (each uses a different lookback window for $r$):
- **6M** — average of 6 monthly returns (same raw value as TSMOM 6M)
- **1M** — latest month-end vs. prior month-end (SQL snapshot rank 1 vs 2)
- **5D** — rank 1 vs rank 6 month-end snapshot (≈ 5-month span)
- **3D** — $r = (P_0 - P_{-3}) / P_{-3} \\times 100$ from daily prices

**Signal:** $\\text{score} > 70$ → Outperforming sector &nbsp;|&nbsp; $\\text{score} < 30$ → Underperforming sector &nbsp;|&nbsp; 30–70 → In-line with sector

---

## 5. CS Momentum — Cross-Sectional, Skip-1-Period

**Idea:** Classic cross-sectional momentum skips the most recent period to avoid short-term reversal noise (e.g. bid-ask bounce), then measures the return over 3 earlier periods. The score ranks each stock against all others on this "cleaner" momentum signal.

**Why skip?** The very latest return often reverses due to market microstructure noise. Skipping 1 period gives a more robust signal.

**General formula** (period = $n$ trading days; skip 1 period, then measure 3 periods back):
$$
r = \\frac{P_{-(n+1)} - P_{-(4n+1)}}{P_{-(4n+1)}} \\times 100 \\qquad \\text{score} = \\text{PERCENT\\_RANK}(r) \\times 100
$$

$P_{-(n+1)}$ = price 1 skip ago; $P_{-(4n+1)}$ = price 1 skip + 3 measurement periods ago.

**CS Mom 1M** — monthly snapshots from DB, skip month 1, compare month 2 to month 5:
$$
r = \\frac{P_{\\text{month2}} - P_{\\text{month5}}}{P_{\\text{month5}}} \\times 100
$$

**CS Mom 5D** — daily prices (needs 21 bars): skip 1 week, measure 3 weeks back:
$$
r = \\frac{P_{-6} - P_{-21}}{P_{-21}} \\times 100
$$

**CS Mom 3D** — daily prices (needs 13 bars): skip 3 days, measure 9 days back:
$$
r = \\frac{P_{-4} - P_{-13}}{P_{-13}} \\times 100
$$

**Signal:** $\\text{score} > 70$ → Strong momentum (top quartile) &nbsp;|&nbsp; $\\text{score} < 30$ → Weak momentum (bottom quartile) &nbsp;|&nbsp; 30–70 → Neutral

---

#### Data & Coverage

Prices from **JQuants API**, stored in \`jp_daily_prices\`. Batch refresh saves ~7 month-end snapshots per stock; full daily history is fetched when a detail page is opened (required for 3D/5D variants). Sector codes: **TSE 33-sector classification** via JQuants /equities/master field S33Nm.
`

function StrategyInfoModal({ onClose }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.55)', display: 'flex',
        alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: 40, overflowY: 'auto',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 'var(--r)', width: '100%', maxWidth: 740,
          margin: '0 16px 60px', boxShadow: '0 8px 40px rgba(0,0,0,0.4)',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px', borderBottom: '1px solid var(--border)',
          position: 'sticky', top: 0, background: 'var(--bg-card)', zIndex: 1,
        }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Score Computation Reference</h3>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 22, color: 'var(--text-3)', lineHeight: 1, padding: '0 4px',
            }}
          >×</button>
        </div>
        <MarkdownReport text={STRAT_INFO_MD} />
      </div>
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

// ── 四季報 financial table ────────────────────────────────────────────────────

const _FINS_METRICS = [
  { key: 'revenue',      fmt: 'M'   },
  { key: 'op_income',    fmt: 'M'   },
  { key: 'ord_income',   fmt: 'M',  hideIfrs: true },
  { key: 'net_income',   fmt: 'M'   },
  { key: 'eps',          fmt: 'f2'  },
  { key: 'dividend',     fmt: 'f2'  },
  { key: 'equity',       fmt: 'M'   },
  { key: 'total_assets', fmt: 'M'   },
  { key: 'equity_ratio', fmt: 'pct' },
  { key: 'bvps',         fmt: 'f2'  },
]

function fmtFins(val, fmt) {
  if (val === null || val === undefined) return '—'
  if (fmt === 'M')   return val === 0 ? '0' : val.toLocaleString()
  if (fmt === 'f2')  return val.toFixed(2)
  if (fmt === 'pct') return val.toFixed(1) + '%'
  return String(val)
}

function ShikihoTable({ fins, t }) {
  const { records = [] } = fins || {}
  if (records.length === 0) return null
  const isIfrs = records.some(r => r.is_ifrs)
  const thS = {
    padding: '6px 10px', fontSize: 11, fontWeight: 500,
    color: 'var(--text-2)', textAlign: 'right', whiteSpace: 'nowrap',
    borderBottom: '1px solid var(--border)', background: 'var(--bg-card)',
  }
  const labelKeys = {
    revenue: 'fins_revenue', op_income: 'fins_op_income', ord_income: 'fins_ord_income',
    net_income: 'fins_net_income', eps: 'fins_eps', dividend: 'fins_dividend',
    equity: 'fins_equity', total_assets: 'fins_assets', equity_ratio: 'fins_equity_ratio',
    bvps: 'fins_bvps',
  }
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>
        {t('fins_unit_m')} {isIfrs ? '(IFRS)' : '(J-GAAP)'}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ ...thS, textAlign: 'left', minWidth: 110 }}>{t('fins_period')}</th>
              {records.map(r => (
                <th key={r.period} style={{ ...thS, minWidth: 88 }}>{r.period}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {_FINS_METRICS.filter(m => !(m.hideIfrs && isIfrs)).map(({ key, fmt }) => (
              <tr key={key} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '6px 10px', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
                  {t(labelKeys[key])}
                </td>
                {records.map((r, i) => (
                  <td key={i} style={{
                    padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace',
                    color: r[key] === null || r[key] === undefined ? 'var(--text-3)' : 'var(--text-1)',
                    whiteSpace: 'nowrap',
                  }}>
                    {fmtFins(r[key], fmt)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Quarterly financial chart ─────────────────────────────────────────────────

function fmtMoney(v) {
  if (v == null) return ''
  const abs = Math.abs(v)
  if (abs >= 1e12) return `${(v / 1e12).toFixed(1)}兆`
  if (abs >= 1e8)  return `${(v / 1e8).toFixed(0)}億`
  if (abs >= 1e6)  return `${(v / 1e6).toFixed(0)}M`
  return v.toFixed(0)
}

function niceMonTicks(min, max) {
  const range = max - min || 1
  const step0 = range / 5
  const mag = Math.pow(10, Math.floor(Math.log10(step0)))
  const step = [1, 2, 5, 10].map(f => f * mag).find(s => s >= step0) || mag * 10
  const lo = Math.floor(min / step) * step
  const hi = Math.ceil(max / step) * step
  const ticks = []
  for (let v = lo; v <= hi + step * 0.01; v += step) ticks.push(Math.round(v * 1e4) / 1e4)
  return ticks
}

function QuarterlyChart({ data, t }) {
  if (!data || data.length === 0) return <NoContent label={t('jp_detail_no_content')} />

  const PAD_L = 72, PAD_R = 52, PAD_T = 12, PAD_B = 32, CHART_H = 250
  const Q_W = 62, BAR_W = 18, BAR_GAP = 3

  const n = data.length
  const plotW = n * Q_W
  const plotH = CHART_H - PAD_T - PAD_B
  const width = PAD_L + plotW + PAD_R

  // Monetary scale (left) — revenue, op_profit, net_income
  const monVals = data.flatMap(d => [d.net_sales, d.op_profit, d.net_income].filter(v => v != null))
  const monMin = Math.min(0, ...monVals)
  const monMax = Math.max(...monVals) * 1.12
  const monRange = monMax - monMin || 1
  const monY = v => v == null ? null : PAD_T + (1 - (v - monMin) / monRange) * plotH

  // YoY % scale (right) — symmetric
  const yoyVals = data.map(d => d.op_profit_yoy).filter(v => v != null)
  const yoyAbs = yoyVals.length ? Math.max(Math.abs(Math.min(...yoyVals)), Math.abs(Math.max(...yoyVals)), 30) * 1.3 : 100
  const yoyMin = -yoyAbs, yoyMax = yoyAbs
  const yoyRange = yoyMax - yoyMin
  const yoyY = v => v == null ? null : PAD_T + (1 - (v - yoyMin) / yoyRange) * plotH
  const zeroYoy = PAD_T + (1 - (0 - yoyMin) / yoyRange) * plotH

  const monTicks = niceMonTicks(monMin, monMax)
  const zeroMon = monY(0)

  // Line point builders
  const linePoints = (fn) => data.map((d, i) => {
    const x = PAD_L + i * Q_W + Q_W / 2
    const y = fn(d)
    return y != null ? [x, y] : null
  })

  const polylines = (pts) => {
    const segs = []; let cur = []
    for (const p of pts) {
      if (p) { cur.push(p) }
      else { if (cur.length > 1) segs.push(cur); cur = [] }
    }
    if (cur.length > 1) segs.push(cur)
    return segs
  }

  const niPts  = linePoints(d => monY(d.net_income))
  const yoyPts = linePoints(d => yoyY(d.op_profit_yoy))
  const niSegs  = polylines(niPts)
  const yoySegs = polylines(yoyPts)

  return (
    <div>
      <div style={{ overflowX: 'auto', overflowY: 'hidden' }}>
        <svg width={width} height={CHART_H} style={{ display: 'block' }}>
          {/* Monetary grid + left labels */}
          {monTicks.map((v, i) => (
            <g key={i}>
              <line x1={PAD_L} y1={monY(v)} x2={PAD_L + plotW} y2={monY(v)}
                stroke="var(--border)" strokeWidth={0.5} strokeDasharray="4,4" />
              <text x={PAD_L - 5} y={monY(v) + 4} textAnchor="end" fontSize={10} fill="var(--text-3)">
                {fmtMoney(v)}
              </text>
            </g>
          ))}

          {/* YoY zero reference */}
          <line x1={PAD_L} y1={zeroYoy} x2={PAD_L + plotW} y2={zeroYoy}
            stroke="#f59e0b" strokeWidth={0.4} strokeDasharray="2,6" opacity={0.6} />

          {/* Right Y-axis labels (YoY %) */}
          {[-50, 0, 50].filter(v => v >= yoyMin && v <= yoyMax).map(v => (
            <text key={v} x={PAD_L + plotW + 5} y={yoyY(v) + 4}
              textAnchor="start" fontSize={10} fill="#f59e0b">
              {v > 0 ? '+' : ''}{v}%
            </text>
          ))}

          {/* Bars */}
          {data.map((d, i) => {
            const gx = PAD_L + i * Q_W + (Q_W - BAR_W * 2 - BAR_GAP) / 2
            const draw = (val, x, color, opacity) => {
              if (val == null) return null
              const top = Math.min(monY(val), zeroMon)
              const h = Math.max(1, Math.abs(zeroMon - monY(val)))
              return <rect x={x} y={top} width={BAR_W} height={h} fill={color} opacity={opacity} />
            }
            return (
              <g key={d.label}>
                {draw(d.net_sales,  gx,              'var(--blue)', 0.25)}
                {draw(d.op_profit,  gx + BAR_W + BAR_GAP, 'var(--blue)', 0.85)}
              </g>
            )
          })}

          {/* Net income line */}
          {niSegs.map((seg, i) => (
            <polyline key={i} points={seg.map(p => p.join(',')).join(' ')}
              fill="none" stroke="#22c55e" strokeWidth={2} />
          ))}
          {niPts.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r={3} fill="#22c55e" />)}

          {/* YoY change line */}
          {yoySegs.map((seg, i) => (
            <polyline key={i} points={seg.map(p => p.join(',')).join(' ')}
              fill="none" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5,3" />
          ))}
          {yoyPts.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r={2.5} fill="#f59e0b" />)}

          {/* X labels */}
          {data.map((d, i) => (
            <text key={i} x={PAD_L + i * Q_W + Q_W / 2} y={CHART_H - 8}
              textAnchor="middle" fontSize={9} fill="var(--text-3)">
              {d.label}
            </text>
          ))}
        </svg>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--text-2)', marginTop: 8, flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 14, height: 10, background: 'rgba(59,130,246,0.25)', display: 'inline-block' }} />
          {t('shikiho_legend_revenue')}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 14, height: 10, background: 'rgba(59,130,246,0.85)', display: 'inline-block' }} />
          {t('shikiho_legend_op_profit')}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#22c55e' }}>
          <span style={{ width: 14, height: 2, background: '#22c55e', display: 'inline-block' }} />
          {t('shikiho_legend_net_income')}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#f59e0b' }}>
          <span style={{ width: 14, height: 2, background: '#f59e0b', display: 'inline-block', borderTop: '2px dashed #f59e0b', height: 0 }} />
          {t('shikiho_legend_yoy')}
        </span>
      </div>
    </div>
  )
}

// ── Strategy score table ──────────────────────────────────────────────────────

function scoreColor(v, invert = false) {
  if (v == null) return 'var(--text-3)'
  if (invert) return v <= 15 ? 'var(--green)' : v >= 85 ? 'var(--red)' : 'var(--text-1)'
  return v >= 70 ? 'var(--green)' : v <= 30 ? 'var(--red)' : 'var(--text-1)'
}

function ScoreBar({ value }) {
  if (value == null) return <span style={{ color: 'var(--text-3)', fontSize: 12 }}>—</span>
  const pct = Math.max(0, Math.min(100, value))
  const color = pct >= 70 ? 'var(--green)' : pct <= 30 ? 'var(--red)' : 'var(--blue)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: 'var(--bg-surface)', borderRadius: 3, border: '1px solid var(--border)', minWidth: 60 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: 13, fontFamily: 'monospace', fontWeight: 600, color, minWidth: 34, textAlign: 'right' }}>
        {value.toFixed(1)}
      </span>
    </div>
  )
}

function StrategySignal({ stratKey, score, t }) {
  if (score == null) return <span style={{ color: 'var(--text-3)', fontSize: 12 }}>{t('strat_na')}</span>
  let label, color
  if (stratKey === 'tsmom' || stratKey === 'tsmom_1m' || stratKey === 'tsmom_5d' || stratKey === 'tsmom_3d') {
    label = score > 50 ? t('strat_tsmom_long') : score < 50 ? t('strat_tsmom_short') : t('strat_tsmom_neutral')
    color = score > 50 ? 'var(--green)' : score < 50 ? 'var(--red)' : 'var(--text-2)'
  } else if (stratKey === 'rsi2') {
    label = score < 15 ? t('strat_rsi2_buy') : score > 85 ? t('strat_rsi2_sell') : t('strat_rsi2_neutral')
    color = score < 15 ? 'var(--green)' : score > 85 ? 'var(--red)' : 'var(--text-2)'
  } else if (stratKey === 'bb') {
    label = score >= 75 ? t('strat_bb_squeeze') : t('strat_bb_normal')
    color = score >= 75 ? 'var(--amber)' : 'var(--text-2)'
  } else if (stratKey === 'pair' || stratKey === 'pair_1m' || stratKey === 'pair_5d' || stratKey === 'pair_3d') {
    label = score > 70 ? t('strat_pair_out') : score < 30 ? t('strat_pair_under') : t('strat_pair_neutral')
    color = score > 70 ? 'var(--green)' : score < 30 ? 'var(--red)' : 'var(--text-2)'
  } else if (stratKey === 'cs_mom' || stratKey === 'cs_mom_1m' || stratKey === 'cs_mom_5d' || stratKey === 'cs_mom_3d') {
    label = score > 70 ? t('strat_cs_mom_top') : score < 30 ? t('strat_cs_mom_bottom') : t('strat_cs_mom_mid')
    color = score > 70 ? 'var(--green)' : score < 30 ? 'var(--red)' : 'var(--text-2)'
  } else {
    label = score > 70 ? t('strat_cs_mom_top') : score < 30 ? t('strat_cs_mom_bottom') : t('strat_cs_mom_mid')
    color = score > 70 ? 'var(--green)' : score < 30 ? 'var(--red)' : 'var(--text-2)'
  }
  return <span style={{ color, fontSize: 12, fontWeight: 500 }}>{label}</span>
}

const _RSI = { key: 'rsi2',  nameKey: 'strat_rsi2', typeKey: 'strat_rsi2_type', holdKey: 'strat_rsi2_hold', marketKey: 'strat_rsi2_market', riskKey: 'strat_rsi2_risk' }
const _BB  = { key: 'bb',    nameKey: 'strat_bb',   typeKey: 'strat_bb_type',   holdKey: 'strat_bb_hold',   marketKey: 'strat_bb_market',   riskKey: 'strat_bb_risk'   }

const STRATEGY_GROUPS = [
  {
    period: '3D',
    strategies: [
      { key: 'tsmom_3d',  nameKey: 'strat_tsmom_3d',  typeKey: 'strat_tsmom_type',   holdKey: 'strat_tsmom_hold',   marketKey: 'strat_tsmom_market',   riskKey: 'strat_tsmom_risk'   },
      _RSI,
      _BB,
      { key: 'pair_3d',   nameKey: 'strat_pair_3d',   typeKey: 'strat_pair_type',    holdKey: 'strat_pair_hold',    marketKey: 'strat_pair_market',    riskKey: 'strat_pair_risk'    },
      { key: 'cs_mom_3d', nameKey: 'strat_cs_mom_3d', typeKey: 'strat_cs_mom_type',  holdKey: 'strat_cs_mom_hold',  marketKey: 'strat_cs_mom_market',  riskKey: 'strat_cs_mom_risk'  },
    ],
  },
  {
    period: '5D',
    strategies: [
      { key: 'tsmom_5d',  nameKey: 'strat_tsmom_5d',  typeKey: 'strat_tsmom_type',   holdKey: 'strat_tsmom_hold',   marketKey: 'strat_tsmom_market',   riskKey: 'strat_tsmom_risk'   },
      _RSI,
      _BB,
      { key: 'pair_5d',   nameKey: 'strat_pair_5d',   typeKey: 'strat_pair_type',    holdKey: 'strat_pair_hold',    marketKey: 'strat_pair_market',    riskKey: 'strat_pair_risk'    },
      { key: 'cs_mom_5d', nameKey: 'strat_cs_mom_5d', typeKey: 'strat_cs_mom_type',  holdKey: 'strat_cs_mom_hold',  marketKey: 'strat_cs_mom_market',  riskKey: 'strat_cs_mom_risk'  },
    ],
  },
  {
    period: '1M',
    strategies: [
      { key: 'tsmom_1m',  nameKey: 'strat_tsmom_1m',  typeKey: 'strat_tsmom_type',   holdKey: 'strat_tsmom_hold',   marketKey: 'strat_tsmom_market',   riskKey: 'strat_tsmom_risk'   },
      _RSI,
      _BB,
      { key: 'pair_1m',   nameKey: 'strat_pair_1m',   typeKey: 'strat_pair_type',    holdKey: 'strat_pair_hold',    marketKey: 'strat_pair_market',    riskKey: 'strat_pair_risk'    },
      { key: 'cs_mom_1m', nameKey: 'strat_cs_mom_1m', typeKey: 'strat_cs_mom_type',  holdKey: 'strat_cs_mom_hold',  marketKey: 'strat_cs_mom_market',  riskKey: 'strat_cs_mom_risk'  },
    ],
  },
  {
    period: '6M',
    strategies: [
      { key: 'tsmom',  nameKey: 'strat_tsmom_6m',  typeKey: 'strat_tsmom_type',  holdKey: 'strat_tsmom_hold',  marketKey: 'strat_tsmom_market',  riskKey: 'strat_tsmom_risk'  },
      _RSI,
      _BB,
      { key: 'pair',   nameKey: 'strat_pair_6m',   typeKey: 'strat_pair_type',   holdKey: 'strat_pair_hold',   marketKey: 'strat_pair_market',   riskKey: 'strat_pair_risk'   },
    ],
  },
]

function StrategyTable({ scores, t }) {
  const [activePeriod, setActivePeriod] = useState('3D')
  const group = STRATEGY_GROUPS.find(g => g.period === activePeriod)

  const thStyle = {
    padding: '8px 12px', fontSize: 11, fontWeight: 500,
    color: 'var(--text-2)', textAlign: 'left', whiteSpace: 'nowrap',
    borderBottom: '1px solid var(--border)', background: 'var(--bg-card)',
  }
  return (
    <div>
      {/* Period tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 14, borderBottom: '2px solid var(--border)' }}>
        {STRATEGY_GROUPS.map(({ period }) => {
          const active = period === activePeriod
          return (
            <button
              key={period}
              onClick={() => setActivePeriod(period)}
              style={{
                padding: '6px 18px', fontSize: 13, fontWeight: 600,
                background: 'none', border: 'none', cursor: 'pointer',
                borderBottom: active ? '2px solid var(--blue)' : '2px solid transparent',
                color: active ? 'var(--blue)' : 'var(--text-2)',
                marginBottom: '-2px', transition: 'color 0.15s',
              }}
            >{period}</button>
          )
        })}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={thStyle}>{'Strategy'}</th>
              <th style={{ ...thStyle, width: 180 }}>{t('strat_col_score')}</th>
              <th style={thStyle}>{t('strat_col_signal')}</th>
              <th style={thStyle}>{t('strat_col_type')}</th>
              <th style={thStyle}>{t('strat_col_hold')}</th>
              <th style={thStyle}>{t('strat_col_market')}</th>
              <th style={{ ...thStyle, color: 'var(--red)' }}>{t('strat_col_risk')}</th>
            </tr>
          </thead>
          <tbody>
          {group.strategies.map(({ key, nameKey, typeKey, holdKey, marketKey, riskKey }) => {
            const score = scores?.[key] ?? null
            const isShared = key === 'rsi2' || key === 'bb'
            return (
              <tr key={key} style={{ borderBottom: '1px solid var(--border)', background: isShared ? 'var(--bg-surface)' : 'transparent' }}>
                <td style={{ padding: '10px 12px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {t(nameKey)}
                  {isShared && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-3)', fontWeight: 400 }}>all periods</span>}
                </td>
                <td style={{ padding: '10px 12px', minWidth: 160 }}>
                  <ScoreBar value={score} />
                </td>
                <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                  <StrategySignal stratKey={key} score={score} t={t} />
                </td>
                <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
                  {t(typeKey)}
                </td>
                <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
                  {t(holdKey)}
                </td>
                <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
                  {t(marketKey)}
                </td>
                <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--red)' }}>
                  {t(riskKey)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  </div>
  )
}

// ── Main detail component ─────────────────────────────────────────────────────

const PERIODS = [
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: '6M', days: 180 },
  { label: '1Y', days: 365 },
]

export default function JapanStockDetail({ code, onBack }) {
  const { t, lang } = useLang()
  const [detail, setDetail]       = useState(null)
  const [loading, setLoading]     = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError]         = useState(null)
  const [period, setPeriod]         = useState(90)
  const [companyInfo, setCompanyInfo] = useState(undefined)
  const [fetchingInfo, setFetchingInfo] = useState(false)
  const [youtubeReport, setYoutubeReport] = useState(undefined)
  const [fetchingYt, setFetchingYt] = useState(false)
  const [showStratInfo, setShowStratInfo] = useState(false)

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
  useEffect(() => {
    if (detail) {
      setCompanyInfo(detail.company_info ?? null)
      setYoutubeReport(detail.youtube_report ?? null)
    }
  }, [detail])

  const handleFetchYoutubeReport = async () => {
    setFetchingYt(true)
    try {
      let channels = [], keywords = []
      try {
        channels = JSON.parse(localStorage.getItem('yt_channels') || '[]')
        keywords = JSON.parse(localStorage.getItem('yt_keywords') || '[]')
      } catch {}
      const { data } = await fetchJpYoutubeReport(code, { channels, keywords })
      setYoutubeReport(data && !data.error ? data : data)
    } catch (e) {
      console.error('YouTube report fetch failed:', e)
    } finally {
      setFetchingYt(false)
    }
  }

  const handleFetchCompanyInfo = async () => {
    setFetchingInfo(true)
    try {
      const { data } = await fetchJpCompanyInfo(code)
      setCompanyInfo(data && Object.keys(data).length ? data : null)
    } catch (e) {
      console.error('Company info fetch failed:', e)
    } finally {
      setFetchingInfo(false)
    }
  }

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
        <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
          {PERIODS.map(p => {
            const cutoff = new Date()
            cutoff.setDate(cutoff.getDate() - p.days)
            const hasData = detail.daily_prices?.some(d => new Date(d.date) >= cutoff)
            return (
              <button
                key={p.label}
                onClick={() => setPeriod(p.days)}
                disabled={!hasData}
                style={{
                  fontSize: 11, padding: '3px 10px',
                  background: period === p.days ? 'var(--blue)' : 'var(--bg-surface)',
                  color: period === p.days ? '#fff' : hasData ? 'var(--text-2)' : 'var(--text-3)',
                  border: `1px solid ${period === p.days ? 'var(--blue)' : 'var(--border)'}`,
                  borderRadius: 'var(--r-sm)', cursor: hasData ? 'pointer' : 'default',
                }}
              >
                {p.label}
              </button>
            )
          })}
        </div>
        {(() => {
          const cutoff = new Date()
          cutoff.setDate(cutoff.getDate() - period)
          const filtered = detail.daily_prices?.filter(d => new Date(d.date) >= cutoff) ?? []
          return filtered.length > 0
            ? <CandlestickChart data={filtered} />
            : <NoContent label={t('jp_detail_no_content')} />
        })()}
      </Section>

      {/* ── Strategy scores ── */}
      <Section
        icon="🎯"
        title={t('jp_detail_strategies')}
        headerRight={
          <button
            onClick={() => setShowStratInfo(true)}
            title="Score computation details"
            style={{
              width: 20, height: 20, borderRadius: '50%',
              border: '1.5px solid var(--text-3)', background: 'none',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700, color: 'var(--text-3)', lineHeight: 1,
              padding: 0,
            }}
          >!</button>
        }
      >
        <StrategyTable scores={detail.scores} t={t} />
      </Section>
      {showStratInfo && <StrategyInfoModal onClose={() => setShowStratInfo(false)} />}

      {/* ── Company overview (AI) ── */}
      {(() => {
        const info = companyInfo || {}
        const hasError = info.error === 'no_credits'
        const summary = (lang === 'ja' ? info.ja : lang === 'zh' ? info.zh : null) || info.en || info.ja || info.zh || ''
        return (
          <Section icon="🏢" title={t('jp_detail_company_info')}>
            {hasError ? (
              <NoContent label={t('company_info_no_credits')} />
            ) : summary ? (
              <div>
                <div style={{
                  maxHeight: 300, overflowY: 'auto',
                  fontSize: 13, lineHeight: 1.8, color: 'var(--text-1)',
                  background: 'var(--bg-surface)', padding: '12px 16px',
                  borderRadius: 'var(--r-sm)', border: '1px solid var(--border)',
                  whiteSpace: 'pre-wrap',
                }}>
                  {summary}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    {t('jp_company_info_credit')}
                  </span>
                  <button
                    onClick={handleFetchCompanyInfo}
                    disabled={fetchingInfo}
                    style={{ fontSize: 11, padding: '2px 10px', background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-2)', borderRadius: 'var(--r-sm)' }}
                  >
                    {fetchingInfo ? t('jp_company_info_generating') : t('jp_company_info_regenerate')}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '20px 16px' }}>
                <div style={{ color: 'var(--text-3)', fontSize: 13, marginBottom: 12 }}>
                  {t('jp_company_info_prompt')}
                </div>
                <button
                  onClick={handleFetchCompanyInfo}
                  disabled={fetchingInfo}
                  style={{ background: 'var(--blue)', color: '#fff', border: 'none', padding: '8px 20px', fontSize: 13, borderRadius: 'var(--r-sm)', cursor: fetchingInfo ? 'default' : 'pointer', opacity: fetchingInfo ? 0.7 : 1 }}
                >
                  {fetchingInfo ? t('jp_company_info_generating') : t('jp_company_info_generate')}
                </button>
              </div>
            )}
          </Section>
        )
      })()}

      {/* ── 四季報 ── */}
      <Section icon="📊" title={t('jp_detail_shikiho')}>

        {/* Business Analysis (AI) */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 10 }}>
            {t('shikiho_analysis')}
          </div>
          {(() => {
            const info = companyInfo || {}
            if (info.error === 'no_credits') return <NoContent label={t('company_info_no_credits')} />
            const analysis = info.analysis
            const hasData = analysis && (analysis.business?.en || analysis.strengths?.en || analysis.ai_relation?.en)
            if (hasData) {
              return (
                <div>
                  {[
                    { field: 'business',   key: 'shikiho_business'   },
                    { field: 'strengths',  key: 'shikiho_strengths'  },
                    { field: 'ai_relation', key: 'shikiho_ai_relation' },
                  ].map(({ field, key }) => {
                    const content = (lang === 'ja' ? analysis[field]?.ja : lang === 'zh' ? analysis[field]?.zh : null) || analysis[field]?.en || analysis[field]?.ja || analysis[field]?.zh || ''
                    return (
                      <div key={field} style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--blue)', marginBottom: 3 }}>
                          {t(key)}
                        </div>
                        <div style={{
                          fontSize: 13, lineHeight: 1.7, color: 'var(--text-1)',
                          background: 'var(--bg-surface)', padding: '8px 12px',
                          borderRadius: 'var(--r-sm)', border: '1px solid var(--border)',
                        }}>
                          {content || '—'}
                        </div>
                      </div>
                    )
                  })}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{t('jp_company_info_credit')}</span>
                    <button onClick={handleFetchCompanyInfo} disabled={fetchingInfo}
                      style={{ fontSize: 11, padding: '2px 10px', background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-2)', borderRadius: 'var(--r-sm)' }}>
                      {fetchingInfo ? t('shikiho_generating') : t('shikiho_regenerate')}
                    </button>
                  </div>
                </div>
              )
            }
            return (
              <div style={{ textAlign: 'center', padding: '16px' }}>
                <div style={{ color: 'var(--text-3)', fontSize: 13, marginBottom: 10 }}>
                  {t('shikiho_generate_prompt')}
                </div>
                <button onClick={handleFetchCompanyInfo} disabled={fetchingInfo}
                  style={{ background: 'var(--blue)', color: '#fff', border: 'none', padding: '7px 18px', fontSize: 13, borderRadius: 'var(--r-sm)', opacity: fetchingInfo ? 0.7 : 1 }}>
                  {fetchingInfo ? t('shikiho_generating') : t('shikiho_generate')}
                </button>
              </div>
            )
          })()}
        </div>

        <div style={{ borderTop: '1px solid var(--border)', marginBottom: 16 }} />

        {/* Quarterly Financial Chart */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 10 }}>
            {t('shikiho_quarterly')}
          </div>
          <QuarterlyChart data={detail.quarterly_fins} t={t} />
        </div>

      </Section>

      {/* ── Placeholder sections ── */}
      {[
        { icon: '📰', key: 'jp_detail_news' },
        { icon: '💬', key: 'jp_detail_sns'  },
      ].map(({ icon, key }) => (
        <Section key={key} icon={icon} title={t(key)}>
          <NoContent label={t('jp_detail_no_content')} />
        </Section>
      ))}

      {/* ── YouTube Analysis ── */}
      <Section icon="▶" title={t('jp_detail_youtube')}>
        {(() => {
          const yt = youtubeReport || {}
          const sentColor = { positive: 'var(--green)', neutral: 'var(--text-3)', negative: 'var(--red)' }
          const sentKey   = { positive: 'yt_sent_positive', neutral: 'yt_sent_neutral', negative: 'yt_sent_negative' }

          if (yt.error === 'no_credits') return <NoContent label={t('yt_no_credits')} />
          if (yt.error === 'no_videos') return (
            <div>
              <NoContent label={t('yt_no_videos')} />
              <div style={{ textAlign: 'center', marginTop: 10 }}>
                <button onClick={handleFetchYoutubeReport} disabled={fetchingYt}
                  style={{ fontSize: 11, padding: '3px 12px', background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-2)', borderRadius: 'var(--r-sm)' }}>
                  {fetchingYt ? t('yt_generating') : t('yt_regenerate')}
                </button>
              </div>
            </div>
          )

          const hasReport = yt.report?.en || yt.report?.ja || yt.report?.zh
          if (!hasReport) return (
            <div style={{ textAlign: 'center', padding: '20px 16px' }}>
              <div style={{ color: 'var(--text-3)', fontSize: 13, marginBottom: 12 }}>{t('yt_generate_prompt')}</div>
              <button onClick={handleFetchYoutubeReport} disabled={fetchingYt}
                style={{ background: 'var(--blue)', color: '#fff', border: 'none', padding: '8px 20px', fontSize: 13, borderRadius: 'var(--r-sm)', opacity: fetchingYt ? 0.7 : 1 }}>
                {fetchingYt ? t('yt_generating') : t('yt_generate')}
              </button>
            </div>
          )

          const mdText = lang === 'ja' ? (yt.report.ja || yt.report.en)
                       : lang === 'zh' ? (yt.report.zh || yt.report.en)
                       : yt.report.en

          return (
            <div>
              {/* Header meta */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap', padding: '0 4px' }}>
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  {yt.videos_analyzed} {t('yt_videos_analyzed')}
                  {yt.generated_at ? ` · ${new Date(yt.generated_at).toLocaleDateString()}` : ''}
                </span>
                {yt.overall_sentiment && (
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: (sentColor[yt.overall_sentiment] || 'var(--text-3)') + '22', color: sentColor[yt.overall_sentiment] || 'var(--text-3)' }}>
                    {t(sentKey[yt.overall_sentiment] || 'yt_sent_neutral')}
                    {yt.sentiment_score != null ? ` ${(yt.sentiment_score * 100).toFixed(0)}%` : ''}
                  </span>
                )}
                <button onClick={handleFetchYoutubeReport} disabled={fetchingYt}
                  style={{ marginLeft: 'auto', fontSize: 11, padding: '2px 10px', background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-2)', borderRadius: 'var(--r-sm)' }}>
                  {fetchingYt ? t('yt_generating') : t('yt_regenerate')}
                </button>
              </div>

              {/* Markdown report */}
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)' }}>
                <MarkdownReport text={mdText} />
              </div>

              {/* Video source list */}
              {(yt.videos || []).length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6, padding: '0 4px' }}>{t('yt_sources')}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {yt.videos.map((v, i) => (
                      <div key={v.video_id || i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', flexWrap: 'wrap' }}>
                        <a href={v.url} target="_blank" rel="noopener noreferrer"
                          style={{ fontSize: 12, color: 'var(--blue)', textDecoration: 'none', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {v.title}
                        </a>
                        <span style={{ fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                          {[v.channel, v.published_at].filter(Boolean).join(' · ')}
                        </span>
                        <span style={{ fontSize: 10, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                          {v.transcript_source === 'youtube' ? t('yt_source_youtube') : t('yt_source_metadata')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })()}
      </Section>

    </div>
  )
}
