import { useState, useEffect } from 'react'
import { useLang } from '../context/LangContext'
import { getPrompts, updatePrompt } from '../api/client'

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

const PROMPT_LABELS = {
  watchlist_insight: { title: 'Watchlist Insight', vars: ['{today}'] },
  news_analysis:     { title: 'News Analysis',     vars: ['{today}', '{company}', '{code}'] },
  ai_decision:       { title: 'AI Decision',       vars: ['{company}', '{code}', '{daily_csv}', '{weekly_csv}'] },
}

function PromptSection({ promptKey, cfg, onSaved }) {
  const [prompt, setPrompt] = useState(cfg.prompt)
  const [maxTokens, setMaxTokens] = useState(cfg.max_tokens)
  const [maxSearches, setMaxSearches] = useState(cfg.max_web_searches ?? '')
  const [status, setStatus] = useState(null) // null | 'saving' | 'saved' | 'error'

  const meta = PROMPT_LABELS[promptKey] || { title: promptKey, vars: [] }
  const hasSearches = cfg.max_web_searches !== undefined

  const save = async () => {
    setStatus('saving')
    try {
      await updatePrompt(promptKey, {
        prompt,
        max_tokens: Number(maxTokens),
        max_web_searches: hasSearches ? Number(maxSearches) : undefined,
      })
      setStatus('saved')
      onSaved(promptKey, { prompt, max_tokens: Number(maxTokens), max_web_searches: hasSearches ? Number(maxSearches) : undefined })
      setTimeout(() => setStatus(null), 2000)
    } catch {
      setStatus('error')
      setTimeout(() => setStatus(null), 3000)
    }
  }

  return (
    <section style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 'var(--r)', padding: 24, marginBottom: 20,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-2)', margin: 0 }}>{meta.title}</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {status === 'saved' && <span style={{ fontSize: 12, color: 'var(--green)' }}>Saved</span>}
          {status === 'error' && <span style={{ fontSize: 12, color: 'var(--red)' }}>Error saving</span>}
          <button
            onClick={save}
            disabled={status === 'saving'}
            style={{ background: 'var(--blue)', color: '#fff', whiteSpace: 'nowrap', opacity: status === 'saving' ? 0.6 : 1 }}
          >{status === 'saving' ? 'Saving…' : 'Save'}</button>
        </div>
      </div>

      {meta.vars.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {meta.vars.map(v => (
            <code key={v} style={{
              fontSize: 11, background: 'var(--bg-surface)', border: '1px solid var(--border)',
              borderRadius: 4, padding: '1px 6px', color: 'var(--text-3)',
            }}>{v}</code>
          ))}
        </div>
      )}

      <textarea
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        rows={8}
        style={{
          width: '100%', fontFamily: 'monospace', fontSize: 12,
          resize: 'vertical', boxSizing: 'border-box',
        }}
      />

      <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <span style={{ color: 'var(--text-3)' }}>max_tokens</span>
          <input
            type="number" value={maxTokens}
            onChange={e => setMaxTokens(e.target.value)}
            style={{ width: 100 }}
          />
        </label>
        {hasSearches && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span style={{ color: 'var(--text-3)' }}>max_web_searches</span>
            <input
              type="number" value={maxSearches}
              onChange={e => setMaxSearches(e.target.value)}
              style={{ width: 80 }}
            />
          </label>
        )}
      </div>
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
  const [promptCfgs, setPromptCfgs] = useState(null)

  useEffect(() => { try { localStorage.setItem('yt_channels', JSON.stringify(channels)) } catch {} }, [channels])
  useEffect(() => { try { localStorage.setItem('yt_keywords', JSON.stringify(keywords)) } catch {} }, [keywords])
  useEffect(() => {
    getPrompts().then(r => setPromptCfgs(r.data)).catch(() => {})
  }, [])

  const handlePromptSaved = (key, updated) =>
    setPromptCfgs(prev => ({ ...prev, [key]: { ...prev[key], ...updated } }))

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '32px 24px' }}>
      <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 4 }}>
        {t('config_title')}
      </h1>
      <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 32 }}>
        {t('cfg_subtitle')}
      </p>

      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>AI Prompts</h2>
      {promptCfgs === null ? (
        <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 24 }}>Loading prompts…</p>
      ) : (
        Object.keys(PROMPT_LABELS).map(key =>
          promptCfgs[key] ? (
            <PromptSection
              key={key}
              promptKey={key}
              cfg={promptCfgs[key]}
              onSaved={handlePromptSaved}
            />
          ) : null
        )
      )}

      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, marginTop: 12 }}>YouTube Research</h2>

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
