import { Fragment } from 'react'
import katex from 'katex'

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

export function InlineText({ text }) {
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

const _isSeparatorRow = (cells) => cells.every(c => /^:?-+:?$/.test(c.trim()))
const _parseCells = (line) => line.replace(/^\||\|$/g, '').split('|').map(c => c.trim())

export function MarkdownReport({ text }) {
  if (!text) return null
  const lines = text.split('\n')
  const els = []
  let listBuf = []
  let mathBuf = null
  let tableBuf = []  // rows of string[] cells; first row = header

  const flushList = () => {
    if (!listBuf.length) return
    els.push(
      <ul key={`ul-${els.length}`} style={{ margin: '4px 0 10px', paddingLeft: 20, fontSize: 13, lineHeight: 1.9, color: 'var(--text-1)' }}>
        {listBuf.map((li, i) => <li key={i}><InlineText text={li} /></li>)}
      </ul>
    )
    listBuf = []
  }

  const flushTable = () => {
    if (!tableBuf.length) return
    const thStyle = {
      padding: '7px 12px', fontSize: 12, fontWeight: 600, textAlign: 'left',
      color: 'var(--text-2)', borderBottom: '2px solid var(--border)',
      background: 'var(--bg-card)', whiteSpace: 'nowrap',
    }
    const tdStyle = {
      padding: '7px 12px', fontSize: 13, color: 'var(--text-1)',
      borderBottom: '1px solid var(--border)', verticalAlign: 'top',
    }
    const [headerRow, ...dataRows] = tableBuf
    els.push(
      <div key={`tbl-${els.length}`} style={{ overflowX: 'auto', margin: '10px 0 14px' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
          <thead>
            <tr>{headerRow.map((h, ci) => <th key={ci} style={thStyle}><InlineText text={h} /></th>)}</tr>
          </thead>
          <tbody>
            {dataRows.map((row, ri) => (
              <tr key={ri} style={{ background: ri % 2 === 1 ? 'var(--bg-surface)' : 'transparent' }}>
                {row.map((cell, ci) => <td key={ci} style={tdStyle}><InlineText text={cell} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
    tableBuf = []
  }

  lines.forEach((raw, i) => {
    const line = raw.trimEnd()

    if (line === '$$') {
      if (mathBuf === null) {
        flushList(); flushTable()
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

    // Table row
    if (line.startsWith('|')) {
      flushList()
      const cells = _parseCells(line)
      if (!_isSeparatorRow(cells)) tableBuf.push(cells)
      return
    }

    // Non-table line — flush any pending table first
    flushTable()

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
  flushTable()
  return <div style={{ padding: '12px 16px' }}>{els}</div>
}
