import { useState, useEffect, useCallback, useRef } from 'react'
import { getJpStocks, getJpStockChart, refreshJpListings, refreshJpPrices, getJpStatus, getJpFilters, computeJpAqr } from '../api/client'
import { useLang } from '../context/LangContext'

// ── Mobile detection ──────────────────────────────────────────────────────────

function useIsMobile() {
  const [mobile, setMobile] = useState(window.innerWidth < 768)
  useEffect(() => {
    const fn = () => setMobile(window.innerWidth < 768)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])
  return mobile
}

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
      borderRadius: 'var(--r-sm)', padding: '12px 16px', minWidth: 240, flex: 1,
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
      {(isRunning || hasError) && (
        <div style={{ fontSize: 12, color: hasError ? 'var(--red)' : 'var(--text-2)', marginBottom: 4, wordBreak: 'break-word' }}>
          {status.message}
        </div>
      )}
      <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
        {status.db_count != null && <span>{Number(status.db_count).toLocaleString()} in DB</span>}
        {status.db_last_update && <span>Last: {new Date(status.db_last_update).toLocaleString()}</span>}
      </div>
    </div>
  )
}

// ── Sortable column header ────────────────────────────────────────────────────

function Th({ col, label, width, sortBy, onSort, right = false, sticky = false }) {
  const active = sortBy.by === col
  return (
    <th
      onClick={() => onSort(col)}
      className={sticky ? 'jp-sticky' : undefined}
      style={{
        padding: '10px 12px', textAlign: right ? 'right' : 'left', width,
        cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', fontSize: 12,
        color: active ? 'var(--text-1)' : 'var(--text-2)',
        fontWeight: active ? 600 : 400,
      }}
    >
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
  const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  const timeStr = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return (
    <div style={{ fontSize: 11, lineHeight: 1.4 }}>
      <div style={{ color: 'var(--text-1)' }}>{dateStr}</div>
      <div style={{ color: 'var(--text-3)' }}>{timeStr}</div>
    </div>
  )
}

// ── Filter select ─────────────────────────────────────────────────────────────

function FilterSelect({ label, value, onChange, options, allLabel }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
      <span style={{ color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          fontSize: 12, padding: '4px 8px',
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 'var(--r-sm)', color: 'var(--text-1)', cursor: 'pointer',
          maxWidth: 180,
        }}
      >
        <option value="">{allLabel}</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  )
}

// value=[] means "all selected / no filter"
function MultiSelect({ label, value, onChange, options, allLabel }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const fn = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [])

  const isAll = value.length === 0
  const isChecked = (opt) => isAll || value.includes(opt)
  const isFiltering = !isAll

  const toggle = (opt) => {
    if (isAll) {
      // All checked → uncheck one → keep all except this one
      onChange(options.filter(o => o !== opt))
    } else {
      const next = value.includes(opt) ? value.filter(v => v !== opt) : [...value, opt]
      // If all are now checked, collapse back to [] (all)
      onChange(next.length === options.length ? [] : next)
    }
  }

  const summary = isAll
    ? allLabel
    : value.length === 1 ? value[0] : `${value.length} / ${options.length}`

  return (
    <div ref={ref} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
      <span style={{ color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{label}</span>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          fontSize: 12, padding: '4px 28px 4px 8px',
          background: isFiltering ? 'var(--blue)' : 'var(--bg-card)',
          border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
          color: isFiltering ? '#fff' : 'var(--text-1)', cursor: 'pointer',
          maxWidth: 200, position: 'relative', textAlign: 'left',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >
        {summary}
        <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 200,
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 'var(--r-sm)', padding: '4px 0',
          maxHeight: 260, overflowY: 'auto', minWidth: 220,
          boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
        }}>
          {isFiltering && (
            <div
              onClick={() => onChange([])}
              style={{ padding: '6px 12px', fontSize: 11, color: 'var(--blue)', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
            >
              ↺ 全選択に戻す
            </div>
          )}
          {options.map(opt => (
            <label
              key={opt}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 12px', cursor: 'pointer', fontSize: 12,
                background: isChecked(opt) ? 'var(--bg-surface)' : 'transparent',
              }}
            >
              <input type="checkbox" checked={isChecked(opt)} onChange={() => toggle(opt)} style={{ cursor: 'pointer', accentColor: 'var(--blue)' }} />
              {opt}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function JapanStocks({ onSelectStock }) {
  const { t } = useLang()
  const isMobile = useIsMobile()

  const [stocks, setStocks]       = useState([])
  const [total, setTotal]         = useState(0)
  const LIMIT = 50

  const ss = (key, fallback) => { try { const v = sessionStorage.getItem(key); return v != null ? JSON.parse(v) : fallback } catch { return fallback } }
  const [sortBy, setSortBy]       = useState(() => ss('jp_sort', { by: 'code', dir: 'asc' }))
  const [page, setPage]           = useState(() => ss('jp_page', 1))
  const [search, setSearch]       = useState(() => ss('jp_search', ''))
  const [searchInput, setSearchInput] = useState(() => ss('jp_search', ''))
  const [filterMarket, setFilterMarket] = useState(() => ss('jp_market', ''))
  const [filterSector, setFilterSector] = useState(() => ss('jp_sector', []))
  const [aqrMin, setAqrMin]       = useState(() => ss('jp_aqr_min', null))
  const [aqrMax, setAqrMax]       = useState(() => ss('jp_aqr_max', null))
  const [filterOptions, setFilterOptions] = useState({ markets: [], sectors: [] })
  const [loading, setLoading]     = useState(false)

  const [status, setStatus]       = useState(null)
  const [actionErr, setActionErr] = useState('')
  const pollRef                   = useRef(null)

  const [chartData, setChartData] = useState({})
  const requestedCharts           = useRef(new Set())

  // ── Persist sort/filter state across navigation ──────────────────────────────

  useEffect(() => { try { sessionStorage.setItem('jp_sort',   JSON.stringify(sortBy)) } catch {} }, [sortBy])
  useEffect(() => { try { sessionStorage.setItem('jp_page',   JSON.stringify(page))   } catch {} }, [page])
  useEffect(() => { try { sessionStorage.setItem('jp_search', JSON.stringify(search)) } catch {} }, [search])
  useEffect(() => { try { sessionStorage.setItem('jp_market', JSON.stringify(filterMarket)) } catch {} }, [filterMarket])
  useEffect(() => { try { sessionStorage.setItem('jp_sector',   JSON.stringify(filterSector)) } catch {} }, [filterSector])
  useEffect(() => { try { sessionStorage.setItem('jp_aqr_min', JSON.stringify(aqrMin))       } catch {} }, [aqrMin])
  useEffect(() => { try { sessionStorage.setItem('jp_aqr_max', JSON.stringify(aqrMax))       } catch {} }, [aqrMax])

  // ── Load filter options once ─────────────────────────────────────────────────

  useEffect(() => {
    getJpFilters().then(({ data }) => setFilterOptions(data)).catch(() => {})
  }, [])

  // ── Status polling ───────────────────────────────────────────────────────────

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
        if (!data.listings?.running && !data.prices?.running && !data.aqr?.running) {
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

  useEffect(() => {
    if (status?.listings?.running || status?.prices?.running || status?.aqr?.running) startPolling()
  }, [status, startPolling])

  // ── Stock list fetching ──────────────────────────────────────────────────────

  const fetchStocks = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await getJpStocks({
        page, limit: LIMIT,
        sort_by: sortBy.by, sort_dir: sortBy.dir,
        search, market: filterMarket, sector: filterSector,
        ...(aqrMin != null && { aqr_min: aqrMin }),
        ...(aqrMax != null && { aqr_max: aqrMax }),
      })
      setStocks(data.data)
      setTotal(data.total)
    } catch (e) {
      console.error('Failed to fetch stocks:', e)
    } finally {
      setLoading(false)
    }
  }, [page, sortBy, search, filterMarket, filterSector, aqrMin, aqrMax])

  useEffect(() => { fetchStocks() }, [fetchStocks])

  // ── Chart lazy loading (batches of 2) ────────────────────────────────────────

  useEffect(() => {
    if (isMobile) return  // skip chart loading on mobile
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
  }, [stocks, isMobile])

  // ── Action handlers ──────────────────────────────────────────────────────────

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
    setSortBy(prev => ({ by: col, dir: prev.by === col && prev.dir === 'asc' ? 'desc' : 'asc' }))
    setPage(1)
  }

  const handleSearch = e => {
    e.preventDefault()
    setSearch(searchInput)
    setPage(1)
  }

  const handleFilterChange = (type, value) => {
    if (type === 'market') setFilterMarket(value)
    else setFilterSector(value)
    setPage(1)
  }

  const totalPages = Math.ceil(total / LIMIT)
  const apiOk = status?.api_configured

  // ── Column definitions ───────────────────────────────────────────────────────

  const COLS_DESKTOP = [
    { col: 'code',            label: t('jp_col_code'),       width: '80px'  },
    { col: 'name',            label: t('jp_col_name'),       width: 'auto',   sticky: true },
    { col: 'market',          label: t('jp_col_market'),     width: '100px' },
    { col: 'sector',          label: t('jp_col_sector'),     width: '150px' },
    { col: 'current_price',   label: t('jp_col_price'),      width: '100px', right: true },
    { col: 'change_6m',       label: t('jp_col_change'),     width: '110px', right: true },
    { col: 'abs_change_6m',   label: t('jp_col_abs_change'), width: '110px', right: true },
    { col: 'aqr_score',       label: t('jp_col_aqr'),        width: '90px',  right: true },
    { col: 'price_updated_at',label: t('jp_col_updated'),    width: '120px' },
  ]

  const COLS_MOBILE = [
    { col: 'name',            label: t('jp_col_name'),       width: 'auto',  sticky: true },
    { col: 'current_price',   label: t('jp_col_price'),      width: '80px',  right: true },
    { col: 'abs_change_6m',   label: t('jp_col_abs_change'), width: '80px',  right: true },
    { col: 'aqr_score',       label: t('jp_col_aqr'),        width: '70px',  right: true },
    { col: 'price_updated_at',label: t('jp_col_updated'),    width: '80px' },
  ]

  const COLS = isMobile ? COLS_MOBILE : COLS_DESKTOP
  // +1 for chart col on desktop; AQR score is already counted in COLS_DESKTOP
  const colSpan = COLS.length + (isMobile ? 0 : 1)

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: isMobile ? '12px' : '24px', maxWidth: 1500, margin: '0 auto' }}>

      {/* Page title */}
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: isMobile ? 18 : 22, fontWeight: 700, marginBottom: 2 }}>{t('jp_title')}</h1>
        {!apiOk && status && (
          <div style={{ fontSize: 13, color: 'var(--amber)', marginTop: 4 }}>
            ⚠ JQUANTS_API_KEY not configured in .env
          </div>
        )}
        {actionErr && <div style={{ fontSize: 13, color: 'var(--red)', marginTop: 4 }}>{actionErr}</div>}
      </div>

      {/* Operation cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <OpCard label={t('jp_op_listings')} status={status?.listings} disabled={!apiOk} onStart={() => handleAction(refreshJpListings)} t={t} />
        <OpCard label={t('jp_op_prices')}   status={status?.prices}   disabled={!apiOk} onStart={() => handleAction(refreshJpPrices)}   t={t} />
        <OpCard label={t('jp_op_aqr')}      status={status?.aqr}      disabled={false}   onStart={() => handleAction(computeJpAqr)}       t={t} />
      </div>

      {/* Search + Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8 }}>
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder={t('jp_search_ph')}
            style={{ width: isMobile ? 160 : 240 }}
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

        <FilterSelect
          label={t('jp_filter_market')}
          value={filterMarket}
          onChange={v => handleFilterChange('market', v)}
          options={filterOptions.markets}
          allLabel={t('jp_filter_all')}
        />
        <MultiSelect
          label={t('jp_filter_sector')}
          value={filterSector}
          onChange={v => handleFilterChange('sector', v)}
          options={filterOptions.sectors}
          allLabel={t('jp_filter_all')}
        />

        {/* AQR range filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
          <span style={{ color: 'var(--text-2)', whiteSpace: 'nowrap' }}>AQR</span>
          {[
            { val: aqrMin, set: setAqrMin, placeholder: 'Min', otherVal: aqrMax, cmp: (v, o) => o == null || v < o },
            { val: aqrMax, set: setAqrMax, placeholder: 'Max', otherVal: aqrMin, cmp: (v, o) => o == null || v > o },
          ].map(({ val, set, placeholder, otherVal, cmp }, idx) => (
            <select
              key={idx}
              value={val ?? ''}
              onChange={e => { set(e.target.value !== '' ? Number(e.target.value) : null); setPage(1) }}
              style={{
                fontSize: 12, padding: '4px 6px',
                background: val != null ? 'var(--blue)' : 'var(--bg-card)',
                border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
                color: val != null ? '#fff' : 'var(--text-1)', cursor: 'pointer',
              }}
            >
              <option value="">{placeholder}</option>
              {[0,10,20,30,40,50,60,70,80,90,100].filter(v => cmp(v, otherVal)).map(v => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          ))}
          {(aqrMin != null || aqrMax != null) && (
            <button
              onClick={() => { setAqrMin(null); setAqrMax(null); setPage(1) }}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: 13, padding: '0 2px' }}
            >✕</button>
          )}
        </div>

        {!isMobile && (
          <>
            <div style={{ flex: 1 }} />
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
          </>
        )}
      </div>

      {/* Table */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r)', overflow: 'hidden', background: 'var(--bg-surface)' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="jp-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: isMobile ? 12 : 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>
                {COLS.map(c => <Th key={c.col} {...c} sortBy={sortBy} onSort={handleSort} />)}
                {!isMobile && (
                  <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-2)', fontWeight: 400, fontSize: 12, width: '180px', whiteSpace: 'nowrap' }}>
                    {t('jp_col_chart')}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {loading && stocks.length === 0 ? (
                <tr><td colSpan={colSpan} style={{ padding: 48, textAlign: 'center', color: 'var(--text-3)' }}>{t('loading')}</td></tr>
              ) : stocks.length === 0 ? (
                <tr><td colSpan={colSpan} style={{ padding: 48, textAlign: 'center', color: 'var(--text-3)' }}>
                  {!apiOk ? t('jp_no_api_key') : status?.listings?.db_count === 0 ? t('jp_no_data') : t('jp_no_results')}
                </td></tr>
              ) : stocks.map(stock => {
                const change     = stock.change_6m
                const absChange  = stock.abs_change_6m
                const isApprox   = stock.change_months != null && stock.change_months < 6
                const changeColor    = change    == null ? 'var(--text-3)' : change    >= 0 ? 'var(--green)' : 'var(--red)'
                const absChangeColor = absChange == null ? 'var(--text-3)' : absChange >= 0 ? 'var(--green)' : 'var(--red)'
                const chart = chartData[stock.code]

                const aqrScore = stock.aqr_score
                const aqrColor = aqrScore == null ? 'var(--text-3)' : aqrScore >= 70 ? 'var(--green)' : aqrScore <= 30 ? 'var(--red)' : 'var(--text-1)'

                return (
                  <tr
                    key={stock.code}
                    onClick={() => onSelectStock?.(stock.code)}
                    style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                  >
                    {/* Code — desktop only */}
                    {!isMobile && (
                      <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 12, color: 'var(--blue)', whiteSpace: 'nowrap' }}>
                        {stock.code}
                      </td>
                    )}

                    {/* Name — sticky */}
                    <td className="jp-sticky" style={{ padding: '8px 12px' }}>
                      <div style={{ fontWeight: 500, lineHeight: 1.3 }}>
                        {isMobile && <span style={{ fontSize: 10, color: 'var(--blue)', marginRight: 6, fontFamily: 'monospace' }}>{stock.code}</span>}
                        {stock.name}
                      </div>
                      {!isMobile && stock.name_en && stock.name_en !== stock.name && (
                        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>{stock.name_en}</div>
                      )}
                    </td>

                    {/* Market — desktop only */}
                    {!isMobile && (
                      <td style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{stock.market || '—'}</td>
                    )}

                    {/* Sector — desktop only */}
                    {!isMobile && (
                      <td style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-2)' }}>{stock.sector || '—'}</td>
                    )}

                    {/* Price */}
                    <td style={{ padding: '8px 12px', fontFamily: 'monospace', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {stock.current_price != null
                        ? `¥${Number(stock.current_price).toLocaleString('ja-JP')}`
                        : <span style={{ color: 'var(--text-3)' }}>—</span>}
                    </td>

                    {/* 6-Mo Change % — desktop only */}
                    {!isMobile && (
                      <td style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {change != null
                          ? <span style={{ color: changeColor, fontWeight: 600 }}>{change >= 0 ? '+' : ''}{Number(change).toFixed(2)}%</span>
                          : <span style={{ color: 'var(--text-3)' }}>—</span>}
                      </td>
                    )}

                    {/* 6-Mo Change ¥ + alert */}
                    <td style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                      {absChange != null ? (
                        <span style={{ color: absChangeColor, fontWeight: 600 }}>
                          {absChange >= 0 ? '+' : ''}¥{Number(absChange).toLocaleString('ja-JP', { maximumFractionDigits: 0 })}
                          {isApprox && (
                            <span
                              title={t('jp_approx_data').replace('{n}', stock.change_months)}
                              style={{ marginLeft: 4, fontSize: 11, color: 'var(--amber)' }}
                            >⚠</span>
                          )}
                        </span>
                      ) : <span style={{ color: 'var(--text-3)' }}>—</span>}
                    </td>

                    {/* AQR Score */}
                    <td style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                      {aqrScore != null
                        ? <span style={{ color: aqrColor, fontWeight: 600 }}>{Number(aqrScore).toFixed(1)}</span>
                        : <span style={{ color: 'var(--text-3)' }}>—</span>}
                    </td>

                    {/* Updated */}
                    <td style={{ padding: '8px 12px' }}>
                      <UpdatedAt iso={stock.price_updated_at} noDataLabel={t('jp_no_price_data')} />
                    </td>

                    {/* Chart — desktop only */}
                    {!isMobile && (
                      <td style={{ padding: '4px 12px' }}>
                        {chart && chart.length > 0
                          ? <Sparkline data={chart} width={160} height={38} />
                          : <div style={{ width: 160, height: 38, display: 'flex', alignItems: 'center', color: 'var(--text-3)', fontSize: 11 }}>
                              {requestedCharts.current.has(stock.code) && !chart ? '…' : '—'}
                            </div>}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
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

      <style>{`
        @keyframes jppulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        .jp-table tbody tr:hover { background: var(--bg-card-h); }
        .jp-table thead th.jp-sticky { background: var(--bg-card); position: sticky; left: 0; z-index: 2; }
        .jp-table tbody tr td.jp-sticky { background: var(--bg-surface); position: sticky; left: 0; z-index: 1; }
        .jp-table tbody tr:hover td.jp-sticky { background: var(--bg-card-h); }
      `}</style>
    </div>
  )
}
