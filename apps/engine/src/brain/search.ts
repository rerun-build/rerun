import type { BrainPageRef, BrainPageType } from '@rerun/contracts'
import { getBrainDb } from '../db/brainDb.js'
import { embedText } from '../memory/embed.js'

export type BrainPassage = { heading: string; content: string }
export type BrainHit = { slug: string; title: string; type: BrainPageType; passages: BrainPassage[]; score: number }
export type BrainSearchResult = { hits: BrainHit[]; related: BrainPageRef[] }

const RRF_K = 60
const PASSAGES_PER_PAGE = 2
const MAX_RELATED = 8

export function toMatchQuery(query: string): string {
    const terms = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
    return [...new Set(terms.filter(t => t.length > 1))].map(t => `"${t}"`).join(' OR ')
}

function addRanked(scores: Map<string, number>, ids: string[]): void {
    ids.forEach((id, rank) => scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + rank + 1)))
}

export async function searchBrain(query: string, limit = 5): Promise<BrainSearchResult> {
    const client = await getBrainDb()
    const k = limit * 4
    const scores = new Map<string, number>()

    const embedding = await embedText(query).catch(() => null)
    if (embedding) {
        const vec = `[${embedding.join(',')}]`
        const rs = await client
            .execute({
                sql: `SELECT c.id FROM vector_top_k('brain_chunks_vec_idx', vector32(?), ?) AS v
                      JOIN brain_chunks c ON c.rowid = v.id
                      ORDER BY vector_distance_cos(c.embedding, vector32(?)) ASC`,
                args: [vec, k, vec],
            })
            .catch(() => null)
        if (rs) addRanked(scores, rs.rows.map(r => String(r.id)))
    }

    const match = toMatchQuery(query)
    if (match) {
        const rs = await client.execute({ sql: 'SELECT chunk_id FROM brain_chunks_fts WHERE brain_chunks_fts MATCH ? ORDER BY rank LIMIT ?', args: [match, k] })
        addRanked(scores, rs.rows.map(r => String(r.chunk_id)))
    }
    if (scores.size === 0) return { hits: [], related: [] }

    const ids = [...scores.keys()]
    const rows = await client.execute({
        sql: `SELECT c.id, c.slug, c.heading, c.content, p.title, p.type FROM brain_chunks c JOIN brain_pages p ON p.slug = c.slug
              WHERE c.id IN (${ids.map(() => '?').join(', ')})`,
        args: ids,
    })

    const pages = new Map<string, BrainHit & { ranked: { score: number; passage: BrainPassage }[] }>()
    for (const row of rows.rows) {
        const slug = String(row.slug)
        const score = scores.get(String(row.id)) ?? 0
        const page = pages.get(slug) ?? { slug, title: String(row.title), type: row.type as BrainPageType, passages: [], score: 0, ranked: [] }
        page.ranked.push({ score, passage: { heading: String(row.heading), content: String(row.content) } })
        page.score = Math.max(page.score, score)
        pages.set(slug, page)
    }

    const hits = [...pages.values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(({ ranked, ...hit }) => ({
            ...hit,
            passages: ranked
                .sort((a, b) => b.score - a.score)
                .slice(0, PASSAGES_PER_PAGE)
                .map(r => r.passage),
        }))

    return { hits, related: await relatedPages(hits.map(h => h.slug)) }
}

async function relatedPages(slugs: string[]): Promise<BrainPageRef[]> {
    if (slugs.length === 0) return []
    const client = await getBrainDb()
    const marks = slugs.map(() => '?').join(', ')
    const rs = await client.execute({
        sql: `SELECT DISTINCT p.slug, p.title FROM brain_links l
              JOIN brain_pages p ON p.slug = CASE WHEN l.from_slug IN (${marks}) THEN l.to_slug ELSE l.from_slug END
              WHERE (l.from_slug IN (${marks}) OR l.to_slug IN (${marks})) AND p.slug NOT IN (${marks})
              ORDER BY p.title LIMIT ?`,
        args: [...slugs, ...slugs, ...slugs, ...slugs, MAX_RELATED],
    })
    return rs.rows.map(r => ({ slug: String(r.slug), title: String(r.title) }))
}
