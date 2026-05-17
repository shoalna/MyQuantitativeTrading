import { useState, useEffect, useCallback, useRef } from 'react'
import { getJpStocks, getJpStockChart, getWatchlistInsight } from '../api/client'
import { useLang } from '../context/LangContext'
import { useFavorites } from '../hooks/useFavorites'
import { Sparkline, Th, UpdatedAt, useIsMobile } from './JapanStocks'
import { MarkdownReport } from './MarkdownReport'

export default function JapanWatchlist({ onSelectStock }) {
  const { t } = useLang()
  const isMobile = useIsMobile()
  const { favorites, toggle: toggleFav } = useFavorites()

  const [stocks, setStocks]     = useState([])
  const [loading, setLoading]   = useState(false)
  const [sortBy, setSortBy]     = useState({ by: 'code', dir: 'asc' })

  const [insight, setInsight]         = useState(null)
  const [insightLoading, setInsightLoading] = useState(false)
  const [insightError, setInsightError]     = useState(null)
  const [insightOpen, setInsightOpen]       = useState(true)

  const [chartData, setChartData] = useState({})
  const requestedCharts           = useRef(new Set())

  const codes = [...favorites]

  // ── Fetch watchlist stocks ────────────────────────────────────────────────────

  const fetchStocks = useCallback(async () => {
    if (codes.length === 0) { setStocks([]); return }
    setLoading(true)
    try {
      const { data } = await getJpStocks({
        code: codes,
        limit: codes.length,
        sort_by: sortBy.by,
        sort_dir: sortBy.dir,
      })
      setStocks(data.data)
    } catch (e) {
      console.error('Failed to fetch watchlist:', e)
    } finally {
      setLoading(false)
    }
  }, [favorites, sortBy])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchStocks() }, [fetchStocks])

  // ── Chart lazy loading ────────────────────────────────────────────────────────

  useEffect(() => {
    if (isMobile) return
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

  // ── AI insight ────────────────────────────────────────────────────────────────

  const fetchInsight = async (refresh = false) => {
    setInsightLoading(true)
    setInsightError(null)
    try {
      const { data } = await getWatchlistInsight(refresh)
      setInsight(data.content)
    } catch (e) {
      const status = e.response?.status
      const detail = e.response?.data?.detail || 'Failed to load insight'
      setInsightError(status === 429 ? `⏳ ${detail}` : detail)
    } finally {
      setInsightLoading(false)
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  const handleSort = col => {
    setSortBy(prev => ({ by: col, dir: prev.by === col && prev.dir === 'asc' ? 'desc' : 'asc' }))
  }

  const scoreColor = (v, invert = false) =>
    v == null ? 'var(--text-3)'
    : invert ? (v <= 15 ? 'var(--green)' : v >= 85 ? 'var(--red)' : 'var(--text-1)')
    : (v >= 70 ? 'var(--green)' : v <= 30 ? 'var(--red)' : 'var(--text-1)')

  const bbColor = (v) =>
    v == null ? 'var(--text-3)' : v >= 75 ? 'var(--amber)' : 'var(--text-1)'

  const scoreCell = (v, invert = false, colorFn = null) => {
    const c = colorFn ? colorFn(v) : scoreColor(v, invert)
    return v != null
      ? <span style={{ color: c, fontWeight: 600 }}>{Number(v).toFixed(1)}</span>
      : <span style={{ color: 'var(--text-3)' }}>—</span>
  }

  // ── Column definitions ────────────────────────────────────────────────────────

  const COLS_DESKTOP = [
    { col: 'code',            label: t('jp_col_code'),       width: '80px'  },
    { col: 'name',            label: t('jp_col_name'),       width: 'auto',   sticky: true },
    { col: 'market',          label: t('jp_col_market'),     width: '100px' },
    { col: 'sector',          label: t('jp_col_sector'),     width: '150px' },
    { col: 'current_price',   label: t('jp_col_price'),      width: '100px', right: true },
    { col: 'change_6m',       label: t('jp_col_change'),     width: '110px', right: true },
    { col: 'abs_change_6m',   label: t('jp_col_abs_change'), width: '110px', right: true },
    { col: 'score_tsmom_3d',   label: t('jp_col_tsmom_3d'),   width: '70px',  right: true },
    { col: 'score_rsi2',      label: t('jp_col_rsi2'),       width: '68px',  right: true },
    { col: 'score_bb',        label: t('jp_col_bb'),         width: '60px',  right: true },
    { col: 'score_pair_3d',   label: t('jp_col_pair_3d'),    width: '60px',  right: true },
    { col: 'score_cs_mom_3d',  label: t('jp_col_cs_mom_3d'),  width: '72px',  right: true },
    { col: 'price_updated_at',label: t('jp_col_updated'),    width: '120px' },
  ]

  const COLS_MOBILE = [
    { col: 'name',            label: t('jp_col_name'),       width: 'auto',  sticky: true },
    { col: 'current_price',   label: t('jp_col_price'),      width: '80px',  right: true },
    { col: 'abs_change_6m',   label: t('jp_col_abs_change'), width: '80px',  right: true },
    { col: 'score_tsmom_3d',   label: t('jp_col_tsmom_3d'),  width: '62px',  right: true },
    { col: 'score_rsi2',      label: t('jp_col_rsi2'),       width: '62px',  right: true },
    { col: 'score_bb',        label: t('jp_col_bb'),         width: '54px',  right: true },
    { col: 'score_pair',      label: t('jp_col_pair'),       width: '54px',  right: true },
    { col: 'score_cs_mom_3d', label: t('jp_col_cs_mom_3d'),  width: '66px',  right: true },
    { col: 'price_updated_at',label: t('jp_col_updated'),    width: '80px' },
  ]

  const COLS = isMobile ? COLS_MOBILE : COLS_DESKTOP
  const colSpan = COLS.length + (isMobile ? 1 : 2)  // +1 star, +1 chart (desktop)

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: isMobile ? '12px' : '24px', maxWidth: 1500, margin: '0 auto' }}>

      {/* ── AI Market Insight Panel ─────────────────────────────────────────── */}
      <div style={{
        marginBottom: 20,
        border: '1px solid var(--border)',
        borderRadius: 'var(--r)',
        background: 'var(--bg-card)',
        overflow: 'hidden',
      }}>
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 16px', cursor: 'pointer',
            borderBottom: insightOpen ? '1px solid var(--border)' : 'none',
            background: 'var(--bg-surface)',
          }}
          onClick={() => setInsightOpen(o => !o)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 15 }}>✦</span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>今日の日本株 — AI トレードアイデア</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {!insightLoading && (
              <button
                onClick={e => { e.stopPropagation(); fetchInsight(!!insight) }}
                style={{
                  padding: '4px 12px', fontSize: 12, fontWeight: 600,
                  background: 'var(--blue)', color: '#fff',
                  border: 'none', borderRadius: 6, cursor: 'pointer',
                }}
              >
                {insight ? '更新' : '生成'}
              </button>
            )}
            <span style={{ fontSize: 13, color: 'var(--text-3)', userSelect: 'none' }}>
              {insightOpen ? '▲' : '▼'}
            </span>
          </div>
        </div>

        {insightOpen && (
          <div>
            {insightLoading && (
              <div style={{ padding: '20px 16px', color: 'var(--text-3)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid var(--border)', borderTopColor: 'var(--blue)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                Claude がリサーチ中…（web 検索中、30 秒程度かかります）
              </div>
            )}
            {insightError && (
              <div style={{ padding: '16px', color: 'var(--red)', fontSize: 13 }}>{insightError}</div>
            )}
            {!insightLoading && !insightError && !insight && (
              <div style={{ padding: '20px 16px', color: 'var(--text-3)', fontSize: 13 }}>
                「生成」を押すと Claude が今日の日本市場を調べて、リスク/リターンの良い銘柄を提案します。
              </div>
            )}
            {insight && <MarkdownReport text={insight} />}
          </div>
        )}
      </div>

      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: isMobile ? 18 : 22, fontWeight: 700, marginBottom: 2 }}>
          {t('watchlist_title')}
        </h1>
        <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>
          {codes.length} {t('jp_companies')}
        </div>
      </div>

      {!isMobile && (
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 11, color: 'var(--text-3)', marginBottom: 12 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke="#22c55e" strokeWidth="1.5"/></svg>
            {t('jp_legend_price')}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke="#3b82f6" strokeWidth="1.5"/></svg>
            {t('jp_legend_ma6')}
          </span>
        </div>
      )}

      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r)', overflow: 'hidden', background: 'var(--bg-surface)' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="jp-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: isMobile ? 12 : 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '10px 8px', width: 36, textAlign: 'center' }} />
                {COLS.map(c => <Th key={c.col} {...c} sortBy={sortBy} onSort={handleSort} />)}
                {!isMobile && (
                  <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-2)', fontWeight: 400, fontSize: 12, width: '180px', whiteSpace: 'nowrap' }}>
                    {t('jp_col_chart')}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {codes.length === 0 ? (
                <tr>
                  <td colSpan={colSpan} style={{ padding: 64, textAlign: 'center', color: 'var(--text-3)' }}>
                    <div style={{ fontSize: 32, marginBottom: 12 }}>☆</div>
                    <div style={{ fontSize: 15, fontWeight: 500 }}>{t('watchlist_empty')}</div>
                    <div style={{ fontSize: 13, marginTop: 6 }}>{t('watchlist_empty_hint')}</div>
                  </td>
                </tr>
              ) : loading && stocks.length === 0 ? (
                <tr><td colSpan={colSpan} style={{ padding: 48, textAlign: 'center', color: 'var(--text-3)' }}>{t('loading')}</td></tr>
              ) : stocks.map(stock => {
                const change    = stock.change_6m
                const absChange = stock.abs_change_6m
                const isApprox  = stock.change_months != null && stock.change_months < 6
                const changeColor    = change    == null ? 'var(--text-3)' : change    >= 0 ? 'var(--green)' : 'var(--red)'
                const absChangeColor = absChange == null ? 'var(--text-3)' : absChange >= 0 ? 'var(--green)' : 'var(--red)'
                const chart = chartData[stock.code]

                return (
                  <tr
                    key={stock.code}
                    onClick={() => onSelectStock?.(stock.code)}
                    style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                  >
                    {/* Favorite star */}
                    <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                      <button
                        onClick={e => { e.stopPropagation(); toggleFav(stock.code) }}
                        title={t('watchlist_fav_remove')}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          fontSize: 16, lineHeight: 1, padding: 2,
                          color: 'var(--amber)',
                        }}
                      >★</button>
                    </td>

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

                    {/* Strategy scores */}
                    <td style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{scoreCell(stock.score_tsmom_3d)}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{scoreCell(stock.score_rsi2, true)}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{scoreCell(stock.score_bb, false, bbColor)}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{scoreCell(stock.score_pair_3d)}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{scoreCell(stock.score_cs_mom_3d)}</td>

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

      <style>{`
        .jp-table tbody tr:hover { background: var(--bg-card-h); }
        .jp-table thead th.jp-sticky { background: var(--bg-card); position: sticky; left: 0; z-index: 2; }
        .jp-table tbody tr td.jp-sticky { background: var(--bg-surface); position: sticky; left: 0; z-index: 1; }
        .jp-table tbody tr:hover td.jp-sticky { background: var(--bg-card-h); }
      `}</style>
    </div>
  )
}
