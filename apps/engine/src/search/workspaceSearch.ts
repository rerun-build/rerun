import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { basename, relative, sep } from 'node:path'
import type { Client } from '@libsql/client'
import { snippetAround, WORKSPACE_SEARCH_HITS_PER_SOURCE, type WorkspaceSearchHit, type WorkspaceSearchResult } from '@rerun/contracts'
import { agentExists } from '../agents/loader.js'
import { listPageFiles } from '../brain/pages.js'
import { isPathSegment, sharedDir, soulPath, workspaceDir } from '../config/paths.js'
import { AGENT_HIDDEN_TABLES, agentDbExists, getAgentDb } from '../db/agentDb.js'
import { getSharedDb, sharedDbExists, SHARED_HIDDEN_TABLES } from '../db/sharedDb.js'
import { listTables, searchTableRows } from '../db/sqlStore.js'
import { walkFiles } from '../files/store.js'
import { listBrainSkills } from '../skills/brain.js'
import { listSkills } from '../skills/loader.js'

const BUDGET_MS = 1500
const MAX_FILE_BYTES = 1024 * 1024
const MAX_WALKED_FILES = 20_000
const BINARY_PROBE_BYTES = 8000

type SearchRun = { needle: string; limit: number; deadline: number; outOfTime: boolean }

function timeIsUp(run: SearchRun): boolean {
    if (Date.now() < run.deadline) return false
    run.outOfTime = true
    return true
}

const mentions = (text: string, needle: string) => text.toLowerCase().includes(needle)

function firstMatchingLine(text: string, needle: string): { line: number; text: string } | null {
    const lines = text.split('\n')
    const index = lines.findIndex(line => mentions(line, needle))
    return index === -1 ? null : { line: index + 1, text: lines[index] }
}

async function searchSouls(run: SearchRun, agentIds: string[]): Promise<WorkspaceSearchHit[]> {
    const hits: WorkspaceSearchHit[] = []
    for (const agentId of agentIds) {
        if (hits.length >= run.limit || timeIsUp(run)) break
        if (!existsSync(soulPath(agentId))) continue
        const match = firstMatchingLine(await readFile(soulPath(agentId), 'utf8'), run.needle)
        if (match) hits.push({ kind: 'coworker', agentId, field: 'soul', line: match.line, snippet: snippetAround(match.text, run.needle) })
    }
    return hits
}

async function searchSkills(run: SearchRun, agentIds: string[]): Promise<WorkspaceSearchHit[]> {
    const shelves: { agentId: string | null; list: () => Promise<{ slug: string; name: string; description: string; body: string }[]> }[] = [
        ...agentIds.map(agentId => ({ agentId, list: () => listSkills(agentId) })),
        { agentId: null, list: listBrainSkills },
    ]
    const hits: WorkspaceSearchHit[] = []
    for (const { agentId, list } of shelves) {
        if (hits.length >= run.limit || timeIsUp(run)) break
        for (const skill of await list()) {
            if (hits.length >= run.limit) break
            // The line of the body that says it, rather than the name the title already shows.
            const line = firstMatchingLine(skill.body, run.needle)?.text ?? [skill.description, skill.name].find(part => mentions(part, run.needle))
            if (line === undefined) continue
            hits.push({ kind: 'skill', agentId, slug: skill.slug, name: skill.name, snippet: snippetAround(line, run.needle) })
        }
    }
    return hits
}

async function readSearchableText(file: string): Promise<string | null> {
    const info = await stat(file)
    if (info.size > MAX_FILE_BYTES) return null
    const buffer = await readFile(file)
    if (buffer.subarray(0, BINARY_PROBE_BYTES).includes(0)) return null
    return buffer.toString('utf8')
}

async function searchFiles(run: SearchRun, agentIds: string[]): Promise<WorkspaceSearchHit[]> {
    const roots = [{ agentId: null, root: sharedDir() }, ...agentIds.map(agentId => ({ agentId, root: workspaceDir(agentId) }))]
    const hits: WorkspaceSearchHit[] = []
    for (const { agentId, root } of roots) {
        if (hits.length >= run.limit || timeIsUp(run)) break
        if (!existsSync(root)) continue
        const files: string[] = []
        await walkFiles(root, files, MAX_WALKED_FILES, { skipHidden: true })
        for (const file of files) {
            if (hits.length >= run.limit || timeIsUp(run)) break
            const name = basename(file)
            const path = relative(root, file).split(sep).join('/')
            const text = await readSearchableText(file).catch(() => null)
            const match = text === null ? null : firstMatchingLine(text, run.needle)
            if (match) hits.push({ kind: 'file', agentId, path, line: match.line, snippet: snippetAround(match.text, run.needle) })
            else if (mentions(name, run.needle)) hits.push({ kind: 'file', agentId, path, line: null, snippet: path })
        }
    }
    return hits
}

async function searchBrainPages(run: SearchRun): Promise<WorkspaceSearchHit[]> {
    const hits: WorkspaceSearchHit[] = []
    for (const page of await listPageFiles()) {
        if (hits.length >= run.limit || timeIsUp(run)) break
        const match = firstMatchingLine(page.content, run.needle)
        if (match) hits.push({ kind: 'brain', slug: page.slug, title: page.title, snippet: snippetAround(match.text, run.needle) })
        else if (mentions(page.title, run.needle)) hits.push({ kind: 'brain', slug: page.slug, title: page.title, snippet: snippetAround(page.content, run.needle) })
    }
    return hits
}

function describeRow(row: Record<string, unknown>, needle: string): { title: string; snippet: string } {
    const cells = Object.entries(row).map(([column, value]) => [column, value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)] as const)
    const title = cells.find(([, value]) => value.trim() && Number.isNaN(Number(value)))?.[1] ?? cells.find(([, value]) => value.trim())?.[1] ?? ''
    // From the matching cell on, the way the row reads: `name: Spring Boost · channel: instagram`.
    const from = cells.findIndex(([, value]) => mentions(value, needle))
    const shown = cells.slice(Math.max(from, 0)).filter(([, value]) => value.trim())
    return { title: snippetAround(title, needle), snippet: snippetAround(shown.map(([column, value]) => `${column}: ${value}`).join(' · '), needle) }
}

async function searchTables(run: SearchRun, agentIds: string[]): Promise<WorkspaceSearchHit[]> {
    const databases: { agentId: string | null; open: () => Promise<Client>; hidden: string[] }[] = [
        ...(sharedDbExists() ? [{ agentId: null, open: getSharedDb, hidden: SHARED_HIDDEN_TABLES }] : []),
        ...agentIds.filter(agentDbExists).map(agentId => ({ agentId, open: () => getAgentDb(agentId), hidden: AGENT_HIDDEN_TABLES })),
    ]
    const hits: WorkspaceSearchHit[] = []
    for (const { agentId, open, hidden } of databases) {
        if (hits.length >= run.limit || timeIsUp(run)) break
        const client = await open()
        for (const { name } of await listTables(client, hidden)) {
            if (hits.length >= run.limit || timeIsUp(run)) break
            for (const { rowId, row } of await searchTableRows(client, name, run.needle, run.limit - hits.length)) {
                hits.push({ kind: 'table', agentId, table: name, rowId, ...describeRow(row, run.needle) })
            }
        }
    }
    return hits
}

// A source that fails (a corrupt database, a file gone mid-read) leaves the others standing.
const settle = (search: Promise<WorkspaceSearchHit[]>) => search.catch(() => [] as WorkspaceSearchHit[])

export async function searchWorkspace(query: string, requestedAgentIds: string[], limit = WORKSPACE_SEARCH_HITS_PER_SOURCE): Promise<WorkspaceSearchResult> {
    const run: SearchRun = { needle: query.trim().toLowerCase(), limit, deadline: Date.now() + BUDGET_MS, outOfTime: false }
    const agentIds = [...new Set(requestedAgentIds)].filter(id => isPathSegment(id) && agentExists(id))
    const sources = await Promise.all([searchSouls(run, agentIds), searchSkills(run, agentIds), searchFiles(run, agentIds), searchBrainPages(run), searchTables(run, agentIds)].map(settle))
    return { hits: sources.flat(), truncated: run.outOfTime }
}
