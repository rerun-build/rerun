import { getSystemDb } from '../systemDb.js'
import { nowIso } from '../../lib/ids.js'

export type MemoryIndexRow = {
    id: string
    agentId: string
    path: string
    content: string
    kind: string
    createdAt: string
    lastAccessedAt: string | null
    accessCount: number
}

export type MemoryHit = MemoryIndexRow & { score: number; similarity: number | null; coverage: number }

const vec = (embedding: number[]) => `[${embedding.join(',')}]`

export async function indexMemory(row: MemoryIndexRow, embedding: number[] | null): Promise<void> {
    const { client } = await getSystemDb(row.agentId)
    if (embedding) {
        await client.execute({
            sql: 'INSERT INTO memories(id, agent_id, path, content, embedding, kind, created_at, last_accessed_at, access_count) VALUES (?, ?, ?, ?, vector32(?), ?, ?, ?, 0)',
            args: [row.id, row.agentId, row.path, row.content, vec(embedding), row.kind, row.createdAt, row.createdAt],
        })
    } else {
        await client.execute({
            sql: 'INSERT INTO memories(id, agent_id, path, content, kind, created_at, last_accessed_at, access_count) VALUES (?, ?, ?, ?, ?, ?, ?, 0)',
            args: [row.id, row.agentId, row.path, row.content, row.kind, row.createdAt, row.createdAt],
        })
    }
    await client.execute({ sql: 'INSERT INTO memories_fts(content, memory_id) VALUES (?, ?)', args: [row.content, row.id] })
}

export async function reindexMemory(row: MemoryIndexRow, embedding: number[] | null): Promise<void> {
    const { client } = await getSystemDb(row.agentId)
    if (embedding) {
        await client.execute({
            sql: 'UPDATE memories SET content = ?, embedding = vector32(?), kind = ?, last_accessed_at = ? WHERE id = ?',
            args: [row.content, vec(embedding), row.kind, nowIso(), row.id],
        })
    } else {
        await client.execute({
            sql: 'UPDATE memories SET content = ?, kind = ?, last_accessed_at = ? WHERE id = ?',
            args: [row.content, row.kind, nowIso(), row.id],
        })
    }
    await client.execute({ sql: 'UPDATE memories_fts SET content = ? WHERE memory_id = ?', args: [row.content, row.id] })
}

export async function deleteMemory(agentId: string, id: string): Promise<void> {
    const { client } = await getSystemDb(agentId)
    await client.execute({ sql: 'DELETE FROM memories WHERE id = ?', args: [id] })
    await client.execute({ sql: 'DELETE FROM memories_fts WHERE memory_id = ?', args: [id] })
}

export async function rewriteMemoryText(agentId: string, needle: string, rewrite: (text: string) => string): Promise<void> {
    const { client } = await getSystemDb(agentId)
    const res = await client.execute({ sql: "SELECT id, content FROM memories WHERE agent_id = ? AND content LIKE ? ESCAPE '\\'", args: [agentId, `%${needle.replace(/[\\%_]/g, '\\$&')}%`] })
    for (const row of res.rows) {
        const content = String(row.content)
        const next = rewrite(content)
        if (next === content) continue
        await client.batch(
            [
                { sql: 'UPDATE memories SET content = ? WHERE id = ?', args: [next, String(row.id)] },
                { sql: 'UPDATE memories_fts SET content = ? WHERE memory_id = ?', args: [next, String(row.id)] },
            ],
            'write',
        )
    }
}

export async function listMemories(agentId: string): Promise<MemoryIndexRow[]> {
    const { client } = await getSystemDb(agentId)
    const res = await client.execute({ sql: 'SELECT id, agent_id, path, content, kind, created_at, last_accessed_at, access_count FROM memories WHERE agent_id = ? ORDER BY created_at DESC', args: [agentId] })
    return res.rows.map(toRow)
}

export async function bumpMemoryAccess(agentId: string, ids: string[], mode: 'full' | 'touch'): Promise<void> {
    if (ids.length === 0) return
    const { client } = await getSystemDb(agentId)
    const placeholders = ids.map(() => '?').join(', ')
    const increment = mode === 'full' ? ', access_count = access_count + 1' : ''
    await client.execute({
        sql: `UPDATE memories SET last_accessed_at = ?${increment} WHERE agent_id = ? AND id IN (${placeholders})`,
        args: [nowIso(), agentId, ...ids],
    })
}

export async function vectorRecall(agentId: string, embedding: number[], k: number): Promise<MemoryHit[]> {
    const { client } = await getSystemDb(agentId)
    const res = await client.execute({
        sql: `SELECT m.id, m.agent_id, m.path, m.content, m.kind, m.created_at, m.last_accessed_at, m.access_count, vector_distance_cos(m.embedding, vector32(?)) AS dist
              FROM vector_top_k('memories_vec_idx', vector32(?), ?) AS v
              JOIN memories m ON m.rowid = v.id
              WHERE m.agent_id = ?
              ORDER BY dist ASC`,
        args: [vec(embedding), vec(embedding), k * 4, agentId],
    })
    return res.rows.slice(0, k).map(r => {
        const similarity = 1 - Number(r.dist)
        return { ...toRow(r), score: similarity, similarity, coverage: 0 }
    })
}

const STOPWORDS = new Set(
    `a about after all also am an and any are as at be been but by can could did do does for from had has have he her him his how if in into is it its just me more my no not of on or our she so some than that the their them then there these they this to up us was we were what when where which who whom why will with would you your
    au aux avec ce ces cet cette comme dans de des du elle elles en est et il ils je la le les leur leurs lui ma mais me mes moi mon ne nos notre nous on ou où par pas pour qu que quel quelle quelles quels qui sa se ses son sont sur ta te tes toi ton tu un une vos votre vous ça été être
    al con como del el ella ellos es esta este esto la las lo los más mi muy para pero por qué se si sin su sus un una uno y ya
    ao aos as com da das do dos ela ele em essa esse isso mas na nas no nos não os para pela pelo por que se sem seu sua um uma
    als auch auf aus bei das dem den der des die ein eine einem einen einer er es für ich im ist mit nicht sie und von was wie wir zu`
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .split(/\s+/)
)

function termsOf(text: string): string[] {
    const folded = text
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
    return folded.match(/[\p{L}\p{N}]+/gu) ?? []
}

function queryTerms(query: string): string[] {
    return [...new Set(termsOf(query).filter(t => t.length > 1 && !STOPWORDS.has(t)))]
}

export async function ftsRecall(agentId: string, query: string, k: number, embedding: number[] | null = null): Promise<MemoryHit[]> {
    const terms = queryTerms(query)
    if (terms.length === 0) return []
    const { client } = await getSystemDb(agentId)
    const similarity = embedding ? 'CASE WHEN m.embedding IS NULL THEN NULL ELSE 1 - vector_distance_cos(m.embedding, vector32(?)) END' : 'NULL'
    const res = await client.execute({
        sql: `SELECT m.id, m.agent_id, m.path, m.content, m.kind, m.created_at, m.last_accessed_at, m.access_count, f.rank AS rank, ${similarity} AS similarity
              FROM memories_fts f
              JOIN memories m ON m.id = f.memory_id
              WHERE memories_fts MATCH ? AND m.agent_id = ?
              ORDER BY f.rank ASC LIMIT ?`,
        args: [...(embedding ? [vec(embedding)] : []), terms.map(t => `"${t}"`).join(' OR '), agentId, k],
    })
    return res.rows.map(r => {
        const row = toRow(r)
        const found = new Set(termsOf(row.content))
        return { ...row, score: -Number(r.rank), similarity: r.similarity == null ? null : Number(r.similarity), coverage: terms.filter(t => found.has(t)).length / terms.length }
    })
}

export async function deleteMemoriesForAgent(agentId: string): Promise<void> {
    const { client } = await getSystemDb(agentId)
    await client.execute({ sql: 'DELETE FROM memories WHERE agent_id = ?', args: [agentId] })
}

function toRow(r: Record<string, unknown>): MemoryIndexRow {
    return {
        id: String(r.id),
        agentId: String(r.agent_id),
        path: String(r.path),
        content: String(r.content),
        kind: String(r.kind),
        createdAt: String(r.created_at),
        lastAccessedAt: r.last_accessed_at == null ? null : String(r.last_accessed_at),
        accessCount: Number(r.access_count ?? 0),
    }
}
