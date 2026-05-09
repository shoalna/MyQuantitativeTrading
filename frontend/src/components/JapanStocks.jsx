import { useState, useEffect, useCallback, useRef } from 'react'
import { getJpStocks, getJpStockChart, refreshJpListings, refreshJpPrices, getJpStatus } from '../api/client'
import { useLang } from '../context/LangContext'

// ── Sparkline SVG ─────────────────────────────────────────────────────────────

function Sparkline({ data, width = 160, height = 38 }) {
  if (!data || data.length < 2) {
    return <div style={{ width, height, display: 'flex', alignItems: 'center', color: 'var(--text-3)', fontSize: 11 }}>—</div>
  }
  const closes = data.map(d => d.close)
  const ma6s = data.filter(d => d.ma6 != null).map(d => d.ma6)
  const allVals = [...closes, ...ma6s]
  const minVal = Math.min(...allVals)
  const maxVal = Math.max(...allVals)
  const range = maxVal - minVal || 1
  const PAD = 3
  const px = i => (i / (data.length - 1)) * width
  const py = v => height - PAD - ((v - minVal) / range) * (height - PAD * 2)
  const closePath = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)},${py(d.close).toFixed(1)}`).join(' ')
  const areaPath = `${closePath} L${px(data.length - 1).toFixed(1)},${height} L${px(0).toFixed(1)},${height} Z`
  const ma6Idx = data.reduce((a, d, i) => d.ma6 != null ? [...a, i] : a, [])
  const ma6Path = ma6Idx.length > 1
    ? ma6Idx.map((i, j) => `${j === 0 ? 'M' : 'L'}${px(i).toFixed(1)},${py(data[i].ma6).toFixed(1)}`).join(' ')
    : null
  const isUp = closes[closes.length - 1] >= closes[0]
  const lineColor = isUp ? '#22c55e' : '#ef4444'
  const uid = useRef(Math.random().toString(36).slice(2)).current
  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity="0.18" />
          <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${uid})`} />
      <path d={closePath} fill="none" stroke={lineColor} strokeWidth="1.2" strokeLinejoin="round" />
      {ma6Path && <path d={ma6Path} fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeLinejoin="round" />}
    </svg>
  )
}

// ── Operation status card ─────────────────────────────────────────────────────

function OpCard({ label, status, onStart, disabled, t }) {
  if (!status) return null
  const isRunning = status.running
  const hasError  = !!status.error
  const isDone    = !isRunning && !hasError && status.last_run

  const dotColor = isRunning ? 'var(--blue)' : hasError ? 'var(--red)' : isDone ? 'var(--green)' : 'var(--text-3)'
  const stateLabel = isRunning
    ? t('jp_syncing')
    : hasError ? t('jp_status_error')
    : isDone    ? t('jp_status_done')
    : t('jp_status_idle')

  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 'var(--r-sm)', padding: '12px 16px', minWidth: 280, flex: 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0,
            boxShadow: isRunning ? `0 0 0 3px ${dotColor}33` : 'none',
            animation: isRunning ? 'jppulse 1.4s infinite' : 'none',
          }} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
          <span style={{ fontSize: 11, color: dotColor, fontWeight: 500 }}>{stateLabel}</span>
        </div>
        <button
          onClick={onStart}
          disabled={disabled || isRunning}
          style={{
            background: isRunning ? 'var(--bg-surface)' : 'var(--blue)',
            color: isRunning ? 'var(--text-3)' : '#fff',
            border: `1px solid ${isRunning ? 'var(--border)' : 'transparent'}`,
            fontSize: 12, padding: '4px 12px',
          }}
        >
          {isRunning ? `⟳ ${t('jp_syncing')}` : '↻ Update'}
        </button>
      </div>

      {/* Progress message */}
      {(isRunning || hasError) && (
        <div style={{
          fontSize: 12,
          color: hasError ? 'var(--red)' : 'var(--text-2)',
          marginBottom: 4,
          wordBreak: 'break-word',
        }}>
          {status.message}
        </div>
      )}

      {/* DB summary row */}
      <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
        {status.db_count != null && (
          <span>{Number(status.db_count).toLocaleString()} in DB</span>
        )}
        {status.db_last_update && (
          <span>Last: {new Date(status.db_last_update).toLocaleString()}</span>
        )}
      </div>
    </div>
  )
}

// ── Sortable column header ────────────────────────────────────────────────────

function Th({ col, label, width, sortBy, onSort, right = false }) {
  const active = sortBy.by === col
  return (
    <th onClick={() => onSort(col)} style={{
      padding: '10px 12px', textAlign: right ? 'right' : 'left', width,
      cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', fontSize: 12,
      color: active ? 'var(--text-1)' : 'var(--text-2)',
      fontWeight: active ? 600 : 400,
    }}>
      {label}
      <span style={{ marginLeft: 4, opacity: active ? 1 : 0.3 }}>
        {active ? (sortBy.dir === 'asc' ? '↑' : '↓') : '↕'}
      </span>
    </th>
  )
}

// ── Updated-at badge ──────────────────────────────────────────────────────────

function UpdatedAt({ iso, noDataLabel }) {
  if (!iso) {
    return (
      <span style={{
        fontSize: 10, fontWeight: 600, padding: '2px 6px',
        borderRadius: 4, background: 'var(--bg-surface)',
        border: '1px solid var(--border)', color: 'var(--text-3)',
      }}>
        {noDataLabel}
      </span>
    )
  }
  const d = new Date(iso)
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return (
    <div style={{ fontSize: 11, lineHeight: 1.4 }}>
      <div style={{ color: 'var(--text-1)' }}>{date}</div>
      <div style={{ color: 'var(--text-3)' }}>{time}</div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function JapanStocks() {
  const { t } = useLang()

  const [stocks, setStocks]       = useState([])
  const [total, setTotal]         = useState(0)
  const [page, setPage]           = useState(1)
  const LIMIT = 50

  const [sortBy, setSortBy]       = useState({ by: 'code', dir: 'asc' })
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch]       = useState('')
  const [loading, setLoading]     = useState(false)

  const [status, setStatus]       = useState(null)
  const [actionErr, setActionErr] = useState('')
  const pollRef                   = useRef(null)

  const [chartData, setChartData] = useState({})
  const requestedCharts           = useRef(new Set())

  // ── Status polling ──────────────────────────────────────────────────────────

  const fetchStatus = useCallback(async () => {
    try {
      const { data } = await getJpStatus()
      setStatus(data)
    } catch { /* silent */ }
  }, [])

  const startPolling = useCallback(() => {
    if (pollRef.current) return
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await getJpStatus()
        setStatus(data)
        if (!data.listings?.running && !data.prices?.running) {
          clearInterval(pollRef.current)
          pollRef.current = null
        }
      } catch { /* silent */ }
    }, 2000)
  }, [])

  useEffect(() => {
    fetchStatus()
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [fetchStatus])

  // Start polling whenever an operation is running
  useEffect(() => {
    if (status?.listings?.running || status?.prices?.running) {
      startPolling()
    }
  }, [status, startPolling])

  // ── Stock list fetching ─────────────────────────────────────────────────────

  const fetchStocks = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await getJpStocks({
        page, limit: LIMIT,
        sort_by: sortBy.by, sort_dir: sortBy.dir,
        search,
      })
      setStocks(data.data)
      setTotal(data.total)
    } catch (e) {
      console.error('Failed to fetch stocks:', e)
    } finally {
      setLoading(false)
    }
  }, [page, sortBy, search])

  useEffect(() => { fetchStocks() }, [fetchStocks])

  // ── Chart lazy loading (batches of 2 to stay within 60/min rate limit) ──────

  useEffect(() => {
    let cancelled = false
    const toLoad = stocks.filter(s => !requestedCharts.current.has(s.code))
    toLoad.forEach(s => requestedCharts.current.add(s.code))
    if (!toLoad.length) return

    const run = async () => {
      for (let i = 0; i < toLoad.length; i += 2) {
        if (cancelled) break
        await Promise.all(toLoad.slice(i, i + 2).map(async ({ code }) => {
          try {
            const { data } = await getJpStockChart(code)
            if (!cancelled) setChartData(prev => ({ ...prev, [code]: data.data }))
          } catch {
            if (!cancelled) setChartData(prev => ({ ...prev, [code]: [] }))
          }
        }))
      }
    }
    run()
    return () => { cancelled = true }
  }, [stocks])

  // ── Action handlers ─────────────────────────────────────────────────────────

  const handleAction = async (apiFn) => {
    setActionErr('')
    try {
      await apiFn()
      startPolling()
      await fetchStatus()
    } catch (e) {
      setActionErr(e.response?.data?.detail || 'Request failed')
    }
  }

  const handleSort = col => {
    setSortBy(prev => ({
      by: col, dir: prev.by === col && prev.dir === 'asc' ? 'desc' : 'asc',
    }))
    setPage(1)
  }

  const handleSearch = e => {
    e.preventDefault()
    setSearch(searchInput)
    setPage(1)
  }

  const totalPages = Math.ceil(total / LIMIT)
  const apiOk = status?.api_configured

  // ── Render ──────────────────────────────────────────────────────────────────

  const COLS = [
    { col: 'code',            label: t('jp_col_code'),    width: '80px'  },
    { col: 'name',            label: t('jp_col_name'),    width: 'auto'  },
    { col: 'market',          label: t('jp_col_market'),  width: '100px' },
    { col: 'sector',          label: t('jp_col_sector'),  width: '150px' },
    { col: 'current_price',   label: t('jp_col_price'),      width: '110px', right: true },
    { col: 'change_6m',       label: t('jp_col_change'),     width: '110px', right: true },
    { col: 'abs_change_6m',   label: t('jp_col_abs_change'), width: '110px', right: true },
    { col: 'price_updated_at',label: t('jp_col_updated'),    width: '130px' },
  ]

  return (
    <div style={{ padding: '24px', maxWidth: 1500, margin: '0 auto' }}>

      {/* ── Page title ── */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 2 }}>{t('jp_title')}</h1>
        {!apiOk && status && (
          <div style={{ fontSize: 13, color: 'var(--amber)', marginTop: 4 }}>
            ⚠ JQUANTS_API_KEY not configured in .env
          </div>
        )}
        {actionErr && (
          <div style={{ fontSize: 13, color: 'var(--red)', marginTop: 4 }}>{actionErr}</div>
        )}
      </div>

      {/* ── Two operation cards ── */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <OpCard
          label={t('jp_op_listings')}
          status={status?.listings}
          disabled={!apiOk}
          onStart={() => handleAction(refreshJpListings)}
          t={t}
        />
        <OpCard
          label={t('jp_op_prices')}
          status={status?.prices}
          disabled={!apiOk}
          onStart={() => handleAction(refreshJpPrices)}
          t={t}
        />
      </div>

      {/* ── Search bar ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8 }}>
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder={t('jp_search_ph')}
            style={{ width: 260 }}
          />
          <button type="submit" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-1)' }}>
            {t('jp_search')}
          </button>
          {search && (
            <button type="button" onClick={() => { setSearchInput(''); setSearch(''); setPage(1) }}
              style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-3)' }}>
              ✕
            </button>
          )}
        </form>

        <div style={{ flex: 1 }} />

        {/* Chart legend */}
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 11, color: 'var(--text-3)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke="#22c55e" strokeWidth="1.5"/></svg>
            {t('jp_legend_price')}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke="#3b82f6" strokeWidth="1.5"/></svg>
            {t('jp_legend_ma6')}
          </span>
        </div>
      </div>

      {/* ── Table ── */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r)', overflow: 'hidden', background: 'var(--bg-surface)' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>
                {COLS.map(c => <Th key={c.col} {...c} sortBy={sortBy} onSort={handleSort} />)}
                <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-2)', fontWeight: 400, fontSize: 12, width: '180px', whiteSpace: 'nowrap' }}>
                  {t('jp_col_chart')}
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && stocks.length === 0 ? (
                <tr><td colSpan={9} style={{ padding: 48, textAlign: 'center', color: 'var(--text-3)' }}>{t('loading')}</td></tr>
              ) : stocks.length === 0 ? (
                <tr><td colSpan={9} style={{ padding: 48, textAlign: 'center', color: 'var(--text-3)' }}>
                  {!apiOk ? t('jp_no_api_key') : status?.listings?.db_count === 0 ? t('jp_no_data') : t('jp_no_results')}
                </td></tr>
              ) : stocks.map(stock => {
                const change = stock.change_6m
                const absChange = stock.abs_change_6m
                const changeColor = change == null ? 'var(--text-3)' : change >= 0 ? 'var(--green)' : 'var(--red)'
                const absChangeColor = absChange == null ? 'var(--text-3)' : absChange >= 0 ? 'var(--green)' : 'var(--red)'
                const chart = chartData[stock.code]

                return (
                  <tr key={stock.code} style={{ borderBottom: '1px solid var(--border)' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-card-h)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 12, color: 'var(--blue)', whiteSpace: 'nowrap' }}>
                      {stock.code}
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <div style={{ fontWeight: 500, lineHeight: 1.3 }}>{stock.name}</div>
                      {stock.name_en && stock.name_en !== stock.name && (
                        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>{stock.name_en}</div>
                      )}
                    </td>
                    <td style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{stock.market || '—'}</td>
                    <td style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-2)' }}>{stock.sector || '—'}</td>
                    <td style={{ padding: '8px 12px', fontFamily: 'monospace', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {stock.current_price != null
                        ? `¥${Number(stock.current_price).toLocaleString('ja-JP')}`
                        : <span style={{ color: 'var(--text-3)' }}>—</span>}
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {change != null
                        ? <span style={{ color: changeColor, fontWeight: 600 }}>{change >= 0 ? '+' : ''}{Number(change).toFixed(2)}%</span>
                        : <span style={{ color: 'var(--text-3)' }}>—</span>}
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                      {absChange != null
                        ? <span style={{ color: absChangeColor, fontWeight: 600 }}>{absChange >= 0 ? '+' : ''}¥{Number(absChange).toLocaleString('ja-JP', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}</span>
                        : <span style={{ color: 'var(--text-3)' }}>—</span>}
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <UpdatedAt iso={stock.price_updated_at} noDataLabel={t('jp_no_price_data')} />
                    </td>
                    <td style={{ padding: '4px 12px' }}>
                      {chart && chart.length > 0
                        ? <Sparkline data={chart} width={160} height={38} />
                        : <div style={{ width: 160, height: 38, display: 'flex', alignItems: 'center', color: 'var(--text-3)', fontSize: 11 }}>
                            {requestedCharts.current.has(stock.code) && !chart ? '…' : '—'}
                          </div>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16 }}>
          {[['«', 1], ['‹', page - 1]].map(([label, target]) => (
            <button key={label} onClick={() => setPage(target)} disabled={page === 1}
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-2)', padding: '6px 10px' }}>
              {label}
            </button>
          ))}
          <span style={{ fontSize: 13, color: 'var(--text-2)', padding: '0 12px' }}>
            {t('jp_page')} {page} / {totalPages}
            <span style={{ color: 'var(--text-3)', marginLeft: 8 }}>({total.toLocaleString()} {t('jp_companies')})</span>
          </span>
          {[['›', page + 1], ['»', totalPages]].map(([label, target]) => (
            <button key={label} onClick={() => setPage(target)} disabled={page === totalPages}
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-2)', padding: '6px 10px' }}>
              {label}
            </button>
          ))}
        </div>
      )}

      <style>{`@keyframes jppulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
    </div>
  )
}
