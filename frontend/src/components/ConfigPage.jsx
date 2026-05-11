import { useState, useEffect } from 'react'
import { useLang } from '../context/LangContext'

const PRESET_KEYWORDS = ['決算', '業績', '株価', '投資家', 'earnings', 'stock analysis', 'business news', 'IR']
const PRESET_CHANNELS = ['テスタ', 'バフェット太郎', 'たぱぞう', 'モトリーフール', 'MONEX', 'SBI証券']

function TagItem({ label, onDelete }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderRadius: 99, padding: '5px 8px 5px 14px', fontSize: 13,
    }}>
      <span>{label}</span>
      <button
        onClick={onDelete}
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'var(--text-3)', padding: '0 4px', fontSize: 14, lineHeight: 1,
          borderRadius: 99,
        }}
      >✕</button>
    </div>
  )
}

function ListSection({ title, desc, items, onAdd, onDelete, placeholder, presets, emptyMsg }) {
  const [input, setInput] = useState('')
  const existing = new Set(items.map(s => s.toLowerCase()))

  const handleAdd = (val) => {
    const v = (val || input).trim()
    if (!v || existing.has(v.toLowerCase())) return
    onAdd(v)
    if (!val) setInput('')
  }

  return (
    <section style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 'var(--r)', padding: 24, marginBottom: 20,
    }}>
      <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: 'var(--text-2)' }}>
        {title}
        <span style={{
          marginLeft: 8, fontSize: 11, fontWeight: 400,
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 99, padding: '1px 8px', color: 'var(--text-3)',
        }}>{items.length}</span>
      </h2>
      <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 16 }}>{desc}</p>

      <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          placeholder={placeholder}
          style={{ flex: 1 }}
        />
        <button
          onClick={() => handleAdd()}
          disabled={!input.trim() || existing.has(input.trim().toLowerCase())}
          style={{ background: 'var(--blue)', color: '#fff', whiteSpace: 'nowrap' }}
        >+ Add</button>
      </div>

      {presets.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Presets
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {presets.filter(p => !existing.has(p.toLowerCase())).map(p => (
              <button
                key={p}
                onClick={() => handleAdd(p)}
                style={{
                  background: 'var(--bg-surface)', color: 'var(--text-2)',
                  border: '1px solid var(--border)', borderRadius: 99,
                  padding: '4px 14px', fontSize: 12, cursor: 'pointer',
                }}
              >+ {p}</button>
            ))}
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-3)', fontStyle: 'italic' }}>{emptyMsg}</p>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {items.map(item => (
            <TagItem key={item} label={item} onDelete={() => onDelete(item)} />
          ))}
        </div>
      )}
    </section>
  )
}

function load(key, def) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? def }
  catch { return def }
}

export default function ConfigPage() {
  const { t } = useLang()

  const [channels, setChannels] = useState(() => load('yt_channels', []))
  const [keywords, setKeywords] = useState(() => load('yt_keywords', []))

  useEffect(() => { try { localStorage.setItem('yt_channels', JSON.stringify(channels)) } catch {} }, [channels])
  useEffect(() => { try { localStorage.setItem('yt_keywords', JSON.stringify(keywords)) } catch {} }, [keywords])

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '32px 24px' }}>
      <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 4 }}>
        {t('config_title')}
      </h1>
      <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 32 }}>
        {t('cfg_subtitle')}
      </p>

      <ListSection
        title={t('cfg_channels_title')}
        desc={t('cfg_channels_desc')}
        items={channels}
        onAdd={v => setChannels(prev => [...prev, v])}
        onDelete={v => setChannels(prev => prev.filter(x => x !== v))}
        placeholder={t('cfg_channels_ph')}
        presets={PRESET_CHANNELS}
        emptyMsg={t('cfg_channels_empty')}
      />

      <ListSection
        title={t('cfg_keywords_title')}
        desc={t('cfg_keywords_desc')}
        items={keywords}
        onAdd={v => setKeywords(prev => [...prev, v])}
        onDelete={v => setKeywords(prev => prev.filter(x => x !== v))}
        placeholder={t('cfg_keywords_ph')}
        presets={PRESET_KEYWORDS}
        emptyMsg={t('cfg_keywords_empty')}
      />
    </main>
  )
}
