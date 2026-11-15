import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const KEEP = /^(?:\/\/\/\s*<reference|\/\*!|\/[/*]\s*(?:eslint(?:[- ]|$)|@vitest-environment|@ts-|[@#]__PURE__|@__NO_SIDE_EFFECTS__|@jsx|prettier-ignore|biome-ignore|webpack[A-Z]|@vite-ignore|istanbul |c8 |v8 |@refresh|@license|@preserve))/

export function loadTs(root, explicit) {
    const req = createRequire(path.join(explicit || root, 'package.json'))
    return req('typescript')
}

function kindOf(ts, file) {
    const ext = path.extname(file).toLowerCase()
    if (ext === '.tsx') return ts.ScriptKind.TSX
    if (ext === '.ts' || ext === '.mts' || ext === '.cts') return ts.ScriptKind.TS
    return ts.ScriptKind.JSX
}

function parse(ts, file, text) {
    if (path.extname(file).toLowerCase() === '.json') return ts.parseJsonText(file, text)
    return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kindOf(ts, file))
}

const isJsDoc = (ts, n) => n.kind >= ts.SyntaxKind.FirstJSDocNode && n.kind <= ts.SyntaxKind.LastJSDocNode

const emptyJsxExpression = (ts, n) => n.kind === ts.SyntaxKind.JsxExpression && !n.expression && !n.dotDotDotToken

export function commentRanges(ts, sf) {
    const text = sf.text
    const seen = new Set()
    const out = []
    const jsxEmpty = []
    const add = (ranges) => {
        for (const r of ranges || []) {
            if (seen.has(r.pos)) continue
            seen.add(r.pos)
            out.push({ pos: r.pos, end: r.end, keep: KEEP.test(text.slice(r.pos, r.end)) })
        }
    }
    const take = (pos) => add(ts.getLeadingCommentRanges(text, pos))
    const jsxTextAt = new Set()
    const mark = (node) => {
        for (const child of node.getChildren(sf)) {
            if (child.kind === ts.SyntaxKind.JsxText) jsxTextAt.add(child.pos)
            mark(child)
        }
    }
    mark(sf)
    const visit = (node) => {
        for (const child of node.getChildren(sf)) {
            if (isJsDoc(ts, child)) continue
            if (child.kind !== ts.SyntaxKind.JsxText) take(child.pos)
            if (!jsxTextAt.has(child.end)) add(ts.getTrailingCommentRanges(text, child.end))
            if (emptyJsxExpression(ts, child)) jsxEmpty.push(child)
            visit(child)
        }
    }
    visit(sf)
    const shebang = text.startsWith('#!')
    return { ranges: out.filter((r) => !(shebang && r.pos === 0)).sort((a, b) => a.pos - b.pos), jsxEmpty }
}

const isBlank = (s) => /^[ \t\r]*$/.test(s)
const lineStart = (text, i) => text.lastIndexOf('\n', i - 1) + 1
const lineEnd = (text, i) => {
    const k = text.indexOf('\n', i)
    return k === -1 ? text.length : k
}

function cuts(text, spans) {
    const out = []
    const word = /[A-Za-z0-9_$]/
    for (const s of spans) {
        const ls = lineStart(text, s.pos)
        const le = lineEnd(text, s.end)
        if (isBlank(text.slice(ls, s.pos)) && isBlank(text.slice(s.end, le))) {
            out.push({ pos: ls, end: Math.min(le + 1, text.length), line: true })
        } else if (isBlank(text.slice(s.end, le))) {
            let p = s.pos
            while (p > ls && (text[p - 1] === ' ' || text[p - 1] === '\t')) p--
            out.push({ pos: p, end: s.end })
        } else {
            const prev = s.pos > 0 ? text[s.pos - 1] : '\n'
            if (s.pos === ls || /[ \t(\[{,]/.test(prev)) {
                let e = s.end
                while (e < le && (text[e] === ' ' || text[e] === '\t')) e++
                out.push({ pos: s.pos, end: e })
            } else {
                out.push({ pos: s.pos, end: s.end, space: word.test(prev) && word.test(text[s.end] || '') })
            }
        }
    }
    out.sort((a, b) => a.pos - b.pos)
    const merged = []
    for (const c of out) {
        const last = merged[merged.length - 1]
        if (last && c.pos <= last.end) {
            last.end = Math.max(last.end, c.end)
            last.line = Boolean(last.line && c.line)
        } else merged.push({ ...c })
    }
    return merged
}

function apply(text, merged) {
    let res = ''
    let at = 0
    for (const c of merged) {
        res += text.slice(at, c.pos)
        if (c.space) res += ' '
        at = c.end
        if (!c.line) continue
        const nextEnd = lineEnd(text, at)
        if (nextEnd >= text.length || !isBlank(text.slice(at, nextEnd))) continue
        const body = res.endsWith('\n') ? res.slice(0, -1) : res
        const prevLine = body.slice(lineStart(body, body.length))
        if (res.length === 0 || isBlank(prevLine) || /[{(\[>]\s*$/.test(prevLine)) at = nextEnd + 1
    }
    return res + text.slice(at)
}

function shape(ts, sf) {
    const parts = []
    let jsx = null
    const flush = () => {
        if (jsx === null) return
        const t = jsx.replace(/\s+/g, ' ').trim()
        if (t) parts.push('T:' + t)
        jsx = null
    }
    const walk = (node) => {
        for (const child of node.getChildren(sf)) {
            if (isJsDoc(ts, child) || emptyJsxExpression(ts, child)) continue
            if (child.kind === ts.SyntaxKind.JsxText) {
                jsx = (jsx || '') + ' ' + child.getText(sf)
                continue
            }
            flush()
            if (child.getChildren(sf).length === 0) {
                parts.push(child.kind + ':' + child.getText(sf))
                continue
            }
            parts.push('(' + child.kind)
            walk(child)
            flush()
            parts.push(')')
        }
    }
    walk(sf)
    flush()
    return parts.join('\u0001')
}

export function stripText(ts, file, text) {
    const sf = parse(ts, file, text)
    const { ranges, jsxEmpty } = commentRanges(ts, sf)
    const drop = ranges.filter((r) => !r.keep)
    const spans = drop.map((r) => ({ pos: r.pos, end: r.end }))
    for (const n of jsxEmpty) {
        const start = n.getStart(sf)
        const inner = text.slice(start + 1, n.end - 1)
        const found = ts.getLeadingCommentRanges(inner, 0) || []
        if (found.some((r) => KEEP.test(inner.slice(r.pos, r.end)))) continue
        spans.push({ pos: start, end: n.end })
    }
    if (!spans.length) return { text, removed: 0, kept: ranges.length - drop.length, same: true }
    const out = apply(text, cuts(text, spans))
    return { text: out, removed: drop.length, kept: ranges.length - drop.length, same: shape(ts, sf) === shape(ts, parse(ts, file, out)) }
}

function main() {
    const args = process.argv.slice(2)
    const get = (k) => {
        const i = args.indexOf(k)
        return i === -1 ? undefined : args[i + 1]
    }
    const root = path.resolve(get('--root') || '.')
    const ts = loadTs(root, get('--ts'))
    const list = fs.readFileSync(get('--list'), 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
    const write = args.includes('--write')
    const report = { files: 0, changed: 0, removed: 0, kept: 0, refused: [], changedFiles: [] }
    for (const rel of list) {
        const file = path.join(root, rel)
        const text = fs.readFileSync(file, 'utf8')
        report.files++
        let r
        try {
            r = stripText(ts, rel, text)
        } catch (e) {
            report.refused.push(rel + ' parse: ' + String(e && e.message).slice(0, 80))
            continue
        }
        report.kept += r.kept
        if (r.text === text) continue
        report.changedFiles.push(rel)
        if (!r.same) {
            report.refused.push(rel + ' shape changed')
            continue
        }
        report.changed++
        report.removed += r.removed
        if (write) fs.writeFileSync(file, r.text)
    }
    process.stdout.write(JSON.stringify(report) + '\n')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
