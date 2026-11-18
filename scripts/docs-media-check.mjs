#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DOCS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../apps/docs')
const IMAGES_DIR = join(DOCS_DIR, 'images')
const IGNORED_DIRS = new Set(['node_modules', 'drafts', '.mintlify'])

const KB = 1024
const BUDGETS = { '.webp': 300 * KB, '.mp4': 3 * KB * KB }

const FILES_BY_COMPONENT = {
    Shot: ['.light.webp', '.dark.webp'],
    Loop: ['.light.mp4', '.dark.mp4', '.light.webp', '.dark.webp'],
}

function walk(dir, keep) {
    let entries
    try {
        entries = readdirSync(dir, { withFileTypes: true })
    } catch {
        return []
    }
    return entries.flatMap((entry) => {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) return IGNORED_DIRS.has(entry.name) ? [] : walk(path, keep)
        return keep(entry.name) ? [path] : []
    })
}

function withoutCodeFences(source) {
    return source.replace(/^(\s*)(```|~~~)[\s\S]*?^\1\2/gm, (block) => block.replace(/[^\n]/g, ' '))
}

function lineOf(source, index) {
    return source.slice(0, index).split('\n').length
}

function attribute(tag, name) {
    const match = tag.match(new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)'|\\{\\s*["'\`]([^"'\`]*)["'\`]\\s*\\})`))
    return match ? (match[1] ?? match[2] ?? match[3]) : undefined
}

function formatSize(bytes) {
    return bytes >= KB * KB ? `${(bytes / KB / KB).toFixed(1)} MB` : `${Math.round(bytes / KB)} KB`
}

const problems = []
const referenced = new Set()

for (const page of walk(DOCS_DIR, (name) => name.endsWith('.mdx') && !name.endsWith('.draft.mdx'))) {
    const pagePath = relative(DOCS_DIR, page)
    const source = withoutCodeFences(readFileSync(page, 'utf8'))

    for (const match of source.matchAll(/<img\b|<video\b|!\[[^\]]*\]\(/g)) {
        problems.push(`${pagePath}:${lineOf(source, match.index)}: use <Shot> or <Loop> from /snippets/media.jsx instead of a raw image or video`)
    }

    for (const match of source.matchAll(/<(Shot|Loop)\b([^>]*?)\/?>/gs)) {
        const [tag, component] = match
        const where = `${pagePath}:${lineOf(source, match.index)}`
        const src = attribute(tag, 'src')
        const alt = attribute(tag, 'alt')

        if (!alt?.trim()) problems.push(`${where}: <${component}> needs an alt that says what it shows`)
        if (!src?.startsWith('/images/')) {
            problems.push(`${where}: <${component}> src must start with /images/ and name the media without its extension`)
            continue
        }
        for (const suffix of FILES_BY_COMPONENT[component]) {
            const file = join(DOCS_DIR, `${src}${suffix}`)
            referenced.add(file)
            try {
                statSync(file)
            } catch {
                problems.push(`${where}: missing ${relative(DOCS_DIR, file)}`)
            }
        }
    }
}

for (const file of walk(IMAGES_DIR, () => true)) {
    const filePath = relative(DOCS_DIR, file)
    const extension = Object.keys(BUDGETS).find((ext) => file.endsWith(ext))
    if (!extension) {
        problems.push(`${filePath}: only .webp and .mp4 files belong in images/`)
        continue
    }
    const { size } = statSync(file)
    if (size > BUDGETS[extension]) {
        problems.push(`${filePath}: ${formatSize(size)} is over the ${formatSize(BUDGETS[extension])} budget of a ${extension} file`)
    }
    if (!referenced.has(file)) problems.push(`${filePath}: no page shows it, delete it with the screen it captured`)
}

if (problems.length > 0) {
    console.error(`docs media: ${problems.length} problem${problems.length === 1 ? '' : 's'}`)
    for (const problem of problems) console.error(`  ${problem}`)
    process.exit(1)
}

console.log(`docs media: ${referenced.size} files referenced, all present and within budget`)
