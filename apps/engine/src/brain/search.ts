import type { BrainPageRef, BrainPageType } from '@rerun/contracts'
import { getBrainDb } from '../db/brainDb.js'
import { embedText } from '../memory/embed.js'
import { parseTags } from './pages.js'

export type BrainPassage = { heading: string; content: string }
export type BrainHit = { slug: string; title: string; type: BrainPageType; passages: BrainPassage[]; score: number; tags: string[]; spaceId: string | null }

export type BrainSearchOptions = {
    limit?: number
    // Pages carrying at least one of these tags.
    tags?: string[]
    // Only the pages filed under this Box.
    onlySpaceId?: string
    // The searching coworker's Box: its pages come first at equal relevance.
    preferSpaceId?: string | null
}
export type BrainSearchResult = { hits: BrainHit[]; related: BrainPageRef[] }

const RRF_K = 60
const PASSAGES_PER_PAGE = 2
const MAX_RELATED = 8
// Two equally good pages still land on neighbouring ranks, under 2% apart in score: the boost lifts
// a page of the coworker's own Box over its neighbour, never over a page two ranks up or found in
// one more list.
const OWN_BOX_BOOST = 1.02
// The vector index cannot be filtered, so a filtered search reads further down it.
const FILTERED_OVERFETCH = 12

// Unicode-aware on purpose: the brain of a French company is written in French, and stripping
// everything outside a-z would turn "procédure" into "proc dure".
export function toMatchQuery(query: string): string {
    const terms = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
    return [...new Set(terms.filter(t => t.length > 1))].map(t => `"${t}"`).join(' OR ')
}

// Vector distances and FTS ranks live on different scales, so they are fused by rank rather than
// by raw score.
function addRanked(scores: Map<string, number>, ids: string[]): void {
    ids.forEach((id, rank) => scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + rank + 1)))
}

function pageFilter({ tags, onlySpaceId }: BrainSearchOptions): { sql: string; args: string[] } {
    const clauses: string[] = []
    const args: string[] = []
    if (tags?.length) {
        clauses.push(`EXISTS (SELECT 1 FROM json_each(COALESCE(p.tags_json, '[]')) t WHERE t.value IN (${tags.map(() => '?').join(', ')}))`)
        args.push(...tags)
    }
    if (onlySpaceId) {
        clauses.push('p.space_id = ?')
        args.push(onlySpaceId)
    }
    return { sql: clauses.join(' AND '), args }
}

export async function searchBrain(query: string, options: BrainSearchOptions = {}): Promise<BrainSearchResult> {
    const limit = options.limit ?? 5
    const filter = pageFilter(options)
    const client = await getBrainDb()
    const k = limit * (filter.sql ? FILTERED_OVERFETCH : 4)
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
        const rs = filter.sql
            ? await client.execute({
                  sql: `SELECT brain_chunks_fts.chunk_id FROM brain_chunks_fts JOIN brain_chunks c ON c.id = brain_chunks_fts.chunk_id JOIN brain_pages p ON p.slug = c.slug
                        WHERE brain_chunks_fts MATCH ? AND ${filter.sql} ORDER BY brain_chunks_fts.rank LIMIT ?`,
                  args: [match, ...filter.args, k],
              })
            : await client.execute({ sql: 'SELECT chunk_id FROM brain_chunks_fts WHERE brain_chunks_fts MATCH ? ORDER BY rank LIMIT ?', args: [match, k] })
        addRanked(scores, rs.rows.map(r => String(r.chunk_id)))
    }
    if (scores.size === 0) return { hits: [], related: [] }

    const ids = [...scores.keys()]
    const rows = await client.execute({
        sql: `SELECT c.id, c.slug, c.heading, c.content, p.title, p.type, p.tags_json, p.space_id FROM brain_chunks c JOIN brain_pages p ON p.slug = c.slug
              WHERE c.id IN (${ids.map(() => '?').join(', ')})${filter.sql ? ` AND ${filter.sql}` : ''}`,
        args: [...ids, ...filter.args],
    })

    const pages = new Map<string, BrainHit & { ranked: { score: number; passage: BrainPassage }[] }>()
    for (const row of rows.rows) {
        const slug = String(row.slug)
        const spaceId = row.space_id == null ? null : String(row.space_id)
        const boost = options.preferSpaceId && spaceId === options.preferSpaceId ? OWN_BOX_BOOST : 1
        const score = (scores.get(String(row.id)) ?? 0) * boost
        const page = pages.get(slug) ?? { slug, title: String(row.title), type: row.type as BrainPageType, tags: parseTags(row.tags_json), spaceId, passages: [], score: 0, ranked: [] }
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

// One hop along the [[links]], both ways: the page about a customer surfaces the competitor it is
// compared to even when the query only matched the customer.
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
