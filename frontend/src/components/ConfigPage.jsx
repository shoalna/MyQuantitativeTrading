import { useState, useEffect } from 'react'
import { getSectors, createSector, updateSector, deleteSector, getTargets, createTarget, deleteTarget } from '../api/client'
import { useLang } from '../context/LangContext'

const PRESET_SECTORS = ['AI', 'Energy', 'Semiconductor', 'Healthcare', 'Finance', 'EV']

const PRESET_COMPANIES = [
  { symbol: 'AAPL',  name: 'Apple Inc.' },
  { symbol: 'NVDA',  name: 'NVIDIA Corp.' },
  { symbol: 'TSLA',  name: 'Tesla Inc.' },
  { symbol: 'MSFT',  name: 'Microsoft Corp.' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.' },
  { symbol: 'AMZN',  name: 'Amazon.com Inc.' },
]

function SectorTag({ sector, onToggle, onDelete }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderRadius: 99, padding: '6px 8px 6px 14px',
    }}>
      <span style={{ fontSize: 13, fontWeight: 500 }}>{sector.name}</span>
      <span style={{ fontSize: 11, color: 'var(--text-3)' }}>top {sector.top_n}</span>
      <button onClick={() => onToggle(sector)} style={{
        background: sector.active ? '#14532d44' : 'var(--bg-card)',
        color: sector.active ? '#22c55e' : 'var(--text-3)',
        border: `1px solid ${sector.active ? '#22c55e44' : 'var(--border)'}`,
        borderRadius: 99, padding: '2px 10px', fontSize: 11, fontWeight: 600,
      }}>{sector.active ? 'ON' : 'OFF'}</button>
      <button onClick={() => onDelete(sector.id)} style={{
        background: 'transparent', color: 'var(--text-3)', padding: '2px 6px', fontSize: 13,
        borderRadius: 99, border: '1px solid transparent',
      }}>✕</button>
    </div>
  )
}

export default function ConfigPage() {
  const { t } = useLang()

  // Sectors
  const [sectors, setSectors] = useState([])
  const [name, setName] = useState('')
  const [topN, setTopN] = useState(5)
  const [adding, setAdding] = useState(false)

  // Targets
  const [targets, setTargets] = useState([])
  const [tSymbol, setTSymbol] = useState('')
  const [tName, setTName] = useState('')
  const [addingTarget, setAddingTarget] = useState(false)
  const [targetError, setTargetError] = useState('')

  const loadSectors = async () => { const { data } = await getSectors(); setSectors(data) }
  const loadTargets = async () => { const { data } = await getTargets(); setTargets(data) }
  const load = async () => { await Promise.all([loadSectors(), loadTargets()]) }
  useEffect(() => { load() }, [])

  const handleAdd = async (sectorName) => {
    const n = (sectorName || name).trim()
    if (!n) return
    setAdding(true)
    try { await createSector({ name: n, top_n: topN }); setName(''); loadSectors() }
    finally { setAdding(false) }
  }

  const handleAddTarget = async (sym, nm) => {
    const s = (sym || tSymbol).trim().toUpperCase()
    const n = (nm  || tName).trim()
    if (!s || !n) return
    setAddingTarget(true)
    setTargetError('')
    try {
      await createTarget({ symbol: s, name: n })
      setTSymbol(''); setTName('')
      loadTargets()
    } catch (e) {
      setTargetError(e.response?.data?.detail || 'Error')
    } finally { setAddingTarget(false) }
  }

  const existingNames    = new Set(sectors.map((s) => s.name.toLowerCase()))
  const existingSymbols  = new Set(targets.map((t) => t.symbol))

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '32px 24px' }}>
      <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 4 }}>
        {t('config_title')}
      </h1>
      <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 32 }}>{t('config_subtitle')}</p>

      {/* Add sector */}
      <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: 24, marginBottom: 20 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: 'var(--text-2)' }}>{t('add_sector_title')}</h2>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input placeholder={t('sector_placeholder')} value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            style={{ flex: 1, minWidth: 160 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{t('top_label')}</span>
            <input type="number" min={1} max={20} value={topN}
              onChange={(e) => setTopN(Number(e.target.value))} style={{ width: 64 }} />
          </div>
          <button onClick={() => handleAdd()} disabled={adding || !name.trim()}
            style={{ background: 'var(--blue)', color: '#fff' }}>{t('add_btn')}</button>
        </div>
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('quick_add')}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {PRESET_SECTORS.filter((p) => !existingNames.has(p.toLowerCase())).map((p) => (
              <button key={p} onClick={() => handleAdd(p)} style={{
                background: 'var(--bg-surface)', color: 'var(--text-2)',
                border: '1px solid var(--border)', borderRadius: 99, padding: '4px 14px', fontSize: 12,
              }}>+ {p}</button>
            ))}
          </div>
        </div>
      </section>

      {/* Active sectors */}
      <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: 24, marginBottom: 20 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: 'var(--text-2)' }}>
          {t('active_sectors')}
          <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 400, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 99, padding: '1px 8px', color: 'var(--text-3)' }}>{sectors.length}</span>
        </h2>
        {sectors.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-3)' }}>{t('no_sectors')}</p>
        ) : (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {sectors.map((s) => (
              <SectorTag key={s.id} sector={s}
                onToggle={async (sec) => { await updateSector(sec.id, { active: !sec.active }); load() }}
                onDelete={async (id) => { await deleteSector(id); load() }} />
            ))}
          </div>
        )}
      </section>

      {/* Target companies — add */}
      <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: 24, marginBottom: 20 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: 'var(--text-2)' }}>{t('targets_title')}</h2>
        <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 16 }}>{t('targets_subtitle')}</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input
            placeholder={t('target_symbol_ph')} value={tSymbol}
            onChange={(e) => setTSymbol(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && handleAddTarget()}
            style={{ width: 110 }}
          />
          <input
            placeholder={t('target_name_ph')} value={tName}
            onChange={(e) => setTName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddTarget()}
            style={{ flex: 1, minWidth: 180 }}
          />
          <button
            onClick={() => handleAddTarget()}
            disabled={addingTarget || !tSymbol.trim() || !tName.trim()}
            style={{ background: 'var(--blue)', color: '#fff' }}
          >{t('target_add')}</button>
        </div>
        {targetError && (
          <p style={{ fontSize: 12, color: '#ef4444', marginTop: 8 }}>{targetError}</p>
        )}
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('quick_add')}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {PRESET_COMPANIES.filter((p) => !existingSymbols.has(p.symbol)).map((p) => (
              <button key={p.symbol} onClick={() => handleAddTarget(p.symbol, p.name)} style={{
                background: 'var(--bg-surface)', color: 'var(--text-2)',
                border: '1px solid var(--border)', borderRadius: 99, padding: '4px 14px', fontSize: 12,
              }}>+ {p.symbol}</button>
            ))}
          </div>
        </div>
      </section>

      {/* Target companies — list */}
      <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: 24, marginBottom: 20 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: 'var(--text-2)' }}>
          {t('active_targets')}
          <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 400, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 99, padding: '1px 8px', color: 'var(--text-3)' }}>{targets.length}</span>
        </h2>
        {targets.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-3)' }}>{t('no_targets')}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {targets.map((tgt, i) => (
              <div key={tgt.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 0',
                borderBottom: i < targets.length - 1 ? '1px solid var(--border)' : 'none',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                    background: 'var(--bg-surface)', border: '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 9, fontWeight: 700, color: 'var(--text-3)',
                  }}>{tgt.symbol.slice(0, 4)}</div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{tgt.symbol}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{tgt.name}</div>
                  </div>
                </div>
                <button onClick={async () => { await deleteTarget(tgt.id); loadTargets() }} style={{
                  background: 'transparent', color: 'var(--text-3)', padding: '4px 8px',
                  fontSize: 13, borderRadius: 6, border: '1px solid transparent',
                }}>✕</button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Schedule */}
      <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: 24 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: 'var(--text-2)' }}>{t('schedule_title')}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', background: '#1d4ed822', color: 'var(--blue)', border: '1px solid #3b82f644', borderRadius: 99 }}>{t('schedule_badge')}</span>
          <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{t('schedule_desc')}</span>
        </div>
      </section>
    </main>
  )
}
