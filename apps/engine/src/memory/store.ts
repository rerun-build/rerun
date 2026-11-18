import { writeMemoryFile, updateMemoryFile, deleteMemoryFile, deleteAllMemoryFiles, readMemoryFile } from './files.js'
import { embedText } from './embed.js'
import { computeStrength, DORMANT_THRESHOLD } from './decay.js'
import { ftsRecall, indexMemory, reindexMemory, deleteMemory as repoDeleteMemory, deleteMemoriesForAgent, vectorRecall, bumpMemoryAccess, type MemoryHit } from '../db/repos/memories.js'
import type { LoadedAgent } from '../agents/types.js'

// Below this cosine a memory has nothing to do with the message. Measured on the memory benchmark
// (text-embedding-3-small): every memory that answers a question sits above it, and a message with
// nothing to recall ("hello", "try again") brings back 0.4 memory on average instead of 5.
export const AUTO_RECALL_MIN_SIMILARITY = 0.25

export type RecallOptions = {
    includeDormant?: boolean
    reinforce?: 'full' | 'touch' | 'none'
    // Drops the hits whose cosine to the query is known and below this. A hit with no cosine (the
    // hub is unreachable, or the memory was stored without a vector) is kept: nothing says it is off.
    minSimilarity?: number
    // How long the embedding of the query may take before the search goes on by keyword alone.
    embedTimeoutMs?: number
}

export type RecalledMemory = {
    id: string
    content: string
    kind: string
    tags: string[]
    createdAt: string
    strength: number
}

export async function writeMemory(agent: LoadedAgent, content: string, kind = 'note', tags: string[] = []): Promise<string> {
    const file = await writeMemoryFile(agent.id, content, kind, tags)
    const embedding = await embedText(content).catch(() => null)
    await indexMemory({ id: file.id, agentId: agent.id, path: file.path, content: file.content, kind: file.kind, createdAt: file.createdAt, lastAccessedAt: file.createdAt, accessCount: 0 }, embedding)
    return file.id
}

export async function updateMemory(agent: LoadedAgent, id: string, content: string): Promise<void> {
    const file = await updateMemoryFile(agent.id, id, content)
    const embedding = await embedText(content).catch(() => null)
    await reindexMemory({ id: file.id, agentId: agent.id, path: file.path, content: file.content, kind: file.kind, createdAt: file.createdAt, lastAccessedAt: null, accessCount: 0 }, embedding)
}

export async function deleteMemory(agent: LoadedAgent, id: string): Promise<void> {
    await deleteMemoryFile(agent.id, id).catch(() => {})
    await repoDeleteMemory(agent.id, id)
}

export async function deleteAllMemories(agent: LoadedAgent): Promise<void> {
    await deleteAllMemoryFiles(agent.id).catch(() => {})
    await deleteMemoriesForAgent(agent.id)
}

// What a keyword hit containing every term of the query adds to its cosine. Enough for an exact
// name or reference to win over a vaguely related memory, too little for one shared common word to
// overturn the semantic order.
const KEYWORD_BONUS = 0.15

// A cosine and a BM25 rank live on different scales, and taking the higher of the two let any
// keyword match outrank every semantic one. The cosine ranks, the keyword leg only adds to it. A
// hit with no cosine starts from the floor: nothing says it is closer or further than that.
function fuse(vectorHits: MemoryHit[], ftsHits: MemoryHit[]): MemoryHit[] {
    const fused = new Map<string, MemoryHit>(vectorHits.map(hit => [hit.id, hit]))
    for (const hit of ftsHits) fused.set(hit.id, { ...hit, similarity: fused.get(hit.id)?.similarity ?? hit.similarity })
    return [...fused.values()].map(hit => ({ ...hit, score: (hit.similarity ?? AUTO_RECALL_MIN_SIMILARITY) + KEYWORD_BONUS * hit.coverage }))
}

export async function recallMemory(agent: LoadedAgent, query: string, k = 5, opts: RecallOptions = {}): Promise<RecalledMemory[]> {
    const embedding = await embedText(query, { timeoutMs: opts.embedTimeoutMs }).catch(() => null)
    const vectorHits = embedding ? await vectorRecall(agent.id, embedding, k * 2).catch(() => []) : []
    const ftsHits = await ftsRecall(agent.id, query, k * 2, embedding).catch(() => [])
    const floor = opts.minSimilarity

    const scored = fuse(vectorHits, ftsHits)
        .filter(hit => floor === undefined || hit.similarity === null || hit.similarity >= floor)
        .map(hit => ({ ...hit, strength: computeStrength(hit) }))
        .filter(hit => opts.includeDormant || hit.strength >= DORMANT_THRESHOLD)
        .map(hit => ({ ...hit, score: hit.score * hit.strength }))

    const top = scored.sort((a, b) => b.score - a.score).slice(0, k)

    const reinforce = opts.reinforce ?? 'full'
    if (reinforce !== 'none' && top.length > 0) {
        await bumpMemoryAccess(agent.id, top.map(h => h.id), reinforce).catch(() => {})
    }

    return Promise.all(
        top.map(async hit => {
            const file = await readMemoryFile(hit.path).catch(() => null)
            return { id: hit.id, content: file?.content ?? hit.content, kind: hit.kind, tags: file?.tags ?? [], createdAt: hit.createdAt, strength: hit.strength }
        })
    )
}
