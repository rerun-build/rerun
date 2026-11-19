import { mkdtempSync, existsSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { startStubHub } from './hub.js'
import { MEMORIES, QUERIES, RECONCILE_CASES, CURATOR_CASES, type QueryCategory, type SeedMemory } from './dataset.js'

const args = new Map(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=') as [string, string]))
const suites = new Set((args.get('suite') ?? 'quality,robustness,scale,llm').split(','))
const models = (args.get('models') ?? 'anthropic/claude-sonnet-5').split(',')
const scaleSteps = (args.get('scale') ?? '100,1000,3000').split(',').map(Number)
const outDir = resolve(args.get('out') ?? resolve(import.meta.dirname, '../../../../.context/memory-bench'))

const dataDir = mkdtempSync(resolve(tmpdir(), 'rerun-memory-bench-'))
const hub = startStubHub({ openrouterKey: process.env.OPENROUTER_API_KEY, cachePath: resolve(outDir, 'embedding-cache.json') })
process.env.RERUN_DATA_DIR = dataDir
process.env.RERUN_API_KEY = 'bench'
process.env.RERUN_LOG_LEVEL = 'fatal'
process.env.RERUN_HUB_BASE_URL = await hub.listen()

const { agentConfigSchema } = await import('@moldwright/contracts')
const { writeMemory, updateMemory, deleteMemory, deleteAllMemories, recallMemory, AUTO_RECALL_MIN_SIMILARITY } = await import('../../src/memory/store.js')
const { reconcileWrite } = await import('../../src/memory/reconcile.js')
const { listMemoryFiles, readMemoryFile } = await import('../../src/memory/files.js')
const { buildMemoryIndex } = await import('../../src/memory/index.js')
const { sweepAgentMemories } = await import('../../src/memory/maintenance.js')
const { computeStrength } = await import('../../src/memory/decay.js')
const { ftsRecall, vectorRecall, listMemories } = await import('../../src/db/repos/memories.js')
const { getSystemDb } = await import('../../src/db/systemDb.js')
const { recallContext } = await import('../../src/agents/systemPrompt.js')
const { runCurator } = await import('../../src/runtime/curator.js')
type LoadedAgent = import('../../src/agents/types.js').LoadedAgent

let chatCalls = 0
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('/chat/completions')) chatCalls++
    return realFetch(input, init)
}) as typeof fetch

let agentSeq = 0
function makeAgent(label: string, model = models[0]!): LoadedAgent {
    const id = `${label}-${++agentSeq}`
    return {
        id,
        config: agentConfigSchema.parse({ name: id }),
        soul: '',
        install: '',
        env: {},
        resolved: {
            provider: 'openrouter',
            model,
            connection: { id: 'bench', env: { OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? '' }, config: { provider: 'openrouter', baseUrl: '', models: [], extraModels: [] } },
        },
    } as unknown as LoadedAgent
}

const HOUR = 3_600_000
const hoursAgo = (h: number) => new Date(Date.now() - h * HOUR).toISOString()
const pct = (n: number, d: number) => (d === 0 ? 'n/a' : `${Math.round((100 * n) / d)}%`)
const ms = (n: number) => `${n.toFixed(1)} ms`

function quantile(values: number[], q: number): number {
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; elapsed: number }> {
    const start = performance.now()
    const value = await fn()
    return { value, elapsed: performance.now() - start }
}

async function seed(agent: LoadedAgent, memories: SeedMemory[]): Promise<Map<string, string>> {
    const ids = new Map<string, string>()
    for (const m of memories) ids.set(m.key, await writeMemory(agent, m.content, m.kind))
    return ids
}

async function age(agentId: string, id: string, hours: number): Promise<void> {
    const { client } = await getSystemDb(agentId)
    await client.execute({ sql: 'UPDATE memories SET created_at = ?, last_accessed_at = ? WHERE id = ?', args: [hoursAgo(hours), hoursAgo(hours), id] })
}

async function count(agentId: string, table: 'memories' | 'memories_fts'): Promise<number> {
    const { client } = await getSystemDb(agentId)
    return Number((await client.execute(`SELECT count(*) AS n FROM ${table}`)).rows[0]!.n)
}

const report: Record<string, unknown> = { startedAt: new Date().toISOString(), models }

type Ranker = (query: string) => Promise<string[]>
type CategoryScore = { n: number; hit1: number; hit5: number; mrr: number; returned: number }

async function scoreRanker(rank: Ranker, keyOf: Map<string, string>): Promise<{ byCategory: Record<string, CategoryScore>; perQuery: { query: string; category: QueryCategory; got: string[]; rank: number }[] }> {
    const byCategory: Record<string, CategoryScore> = {}
    const perQuery: { query: string; category: QueryCategory; got: string[]; rank: number }[] = []
    for (const q of QUERIES) {
        const got = (await rank(q.query)).map(id => keyOf.get(id) ?? id)
        const position = got.findIndex(key => q.expect.includes(key))
        const bucket = (byCategory[q.category] ??= { n: 0, hit1: 0, hit5: 0, mrr: 0, returned: 0 })
        bucket.n++
        bucket.returned += got.length
        if (position === 0) bucket.hit1++
        if (position >= 0) {
            bucket.hit5++
            bucket.mrr += 1 / (position + 1)
        }
        perQuery.push({ query: q.query, category: q.category, got, rank: position + 1 })
    }
    return { byCategory, perQuery }
}

function printScores(title: string, byCategory: Record<string, CategoryScore>): void {
    console.log(`\n  ${title}`)
    console.log('  category       n   hit@1   hit@5    MRR   avg returned')
    let n = 0
    let hit1 = 0
    let hit5 = 0
    let mrr = 0
    for (const [category, s] of Object.entries(byCategory)) {
        if (category === 'negative') {
            console.log(`  ${category.padEnd(13)} ${String(s.n).padStart(2)}       -       -      -   ${(s.returned / s.n).toFixed(1)}  (should be 0)`)
            continue
        }
        n += s.n
        hit1 += s.hit1
        hit5 += s.hit5
        mrr += s.mrr
        console.log(`  ${category.padEnd(13)} ${String(s.n).padStart(2)}  ${pct(s.hit1, s.n).padStart(6)}  ${pct(s.hit5, s.n).padStart(6)}  ${(s.mrr / s.n).toFixed(2).padStart(5)}   ${(s.returned / s.n).toFixed(1)}`)
    }
    console.log(`  ${'ALL (pos.)'.padEnd(13)} ${String(n).padStart(2)}  ${pct(hit1, n).padStart(6)}  ${pct(hit5, n).padStart(6)}  ${(mrr / n).toFixed(2).padStart(5)}`)
}

async function qualitySuite(): Promise<void> {
    console.log(`\n=== 1. RETRIEVAL QUALITY (${MEMORIES.length} memories, ${QUERIES.length} labelled queries, k=5) ===`)
    const out: Record<string, unknown> = {}

    hub.setMode('real')
    const hybridAgent = makeAgent('quality-hybrid')
    const hybridIds = await seed(hybridAgent, MEMORIES)
    const hybridKeys = new Map([...hybridIds].map(([key, id]) => [id, key]))

    const hybrid = await scoreRanker(async q => (await recallMemory(hybridAgent, q, 5, { reinforce: 'none' })).map(m => m.id), hybridKeys)
    printScores('hybrid (what memory_recall runs when the hub answers)', hybrid.byCategory)
    out.hybrid = hybrid

    const vectorOnly = await scoreRanker(async q => (await vectorRecall(hybridAgent.id, await hub.embed(q), 5)).map(m => m.id), hybridKeys)
    printScores('vector only (diagnostic: same index, FTS leg removed)', vectorOnly.byCategory)
    out.vectorOnly = vectorOnly

    hub.setMode('none')
    const ftsAgent = makeAgent('quality-fts')
    const ftsIds = await seed(ftsAgent, MEMORIES)
    const ftsKeys = new Map([...ftsIds].map(([key, id]) => [id, key]))
    const fts = await scoreRanker(async q => (await recallMemory(ftsAgent, q, 5, { reinforce: 'none' })).map(m => m.id), ftsKeys)
    printScores('FTS only (what production runs when the hub is unreachable or unset)', fts.byCategory)
    out.ftsOnly = fts
    hub.setMode('real')

    const vectorTop: number[] = []
    const ftsTop: number[] = []
    let ftsWinsTop = 0
    let regressions = 0
    let rescues = 0
    const regressionExamples: string[] = []
    for (const [i, q] of QUERIES.entries()) {
        const v = await vectorRecall(hybridAgent.id, await hub.embed(q.query), 10)
        const f = await ftsRecall(hybridAgent.id, q.query, 10)
        if (v[0]) vectorTop.push(v[0].score)
        if (f[0]) ftsTop.push(f[0].score)
        if (f[0] && v[0] && f[0].score > v[0].score) ftsWinsTop++
        if (q.category === 'negative') continue
        const vectorRank = vectorOnly.perQuery[i]!.rank
        const hybridRank = hybrid.perQuery[i]!.rank
        if (vectorRank === 1 && hybridRank !== 1) {
            regressions++
            regressionExamples.push(`"${q.query}" -> vector #1 = ${vectorOnly.perQuery[i]!.got[0]}, hybrid #1 = ${hybrid.perQuery[i]!.got[0]} (expected ${q.expect.join('|')})`)
        }
        if (vectorRank !== 1 && hybridRank === 1) rescues++
    }
    console.log('\n  score scales of the two legs (why they cannot be merged by raw score)')
    console.log(`  vector top-1 score   min ${Math.min(...vectorTop).toFixed(3)}  median ${quantile(vectorTop, 0.5).toFixed(3)}  max ${Math.max(...vectorTop).toFixed(3)}`)
    console.log(`  FTS top-1 score      min ${Math.min(...ftsTop).toFixed(3)}  median ${quantile(ftsTop, 0.5).toFixed(3)}  max ${Math.max(...ftsTop).toFixed(3)}`)
    console.log(`  hybrid breaks a correct vector #1: ${regressions}   hybrid fixes a wrong vector #1: ${rescues}`)
    for (const line of regressionExamples) console.log(`    - ${line}`)
    out.fusion = { vectorTop, ftsTop, ftsWinsTop, regressions, rescues, regressionExamples }

    for (const floor of [0.2, 0.25, 0.3, 0.35]) {
        const gated = await scoreRanker(async q => (await recallMemory(hybridAgent, q, 5, { reinforce: 'none', minSimilarity: floor })).map(m => m.id), hybridKeys)
        printScores(`hybrid with a similarity floor of ${floor}${floor === AUTO_RECALL_MIN_SIMILARITY ? ' (what the per-turn injection runs)' : ''}`, gated.byCategory)
        out[`floor-${floor}`] = gated.byCategory
    }

    const topScore = async (query: string) => (await vectorRecall(hybridAgent.id, await hub.embed(query), 1))[0]?.score ?? 0
    const positives: number[] = []
    const negatives: number[] = []
    for (const q of QUERIES) (q.category === 'negative' ? negatives : positives).push(await topScore(q.query))
    console.log(`\n  can a relevance floor separate real questions from noise? cosine of the best vector hit:`)
    console.log(`  questions with an answer in memory   min ${Math.min(...positives).toFixed(2)}  median ${quantile(positives, 0.5).toFixed(2)}`)
    console.log(`  messages with nothing to recall      max ${Math.max(...negatives).toFixed(2)}  median ${quantile(negatives, 0.5).toFixed(2)}`)
    out.floor = { positives, negatives }

    const injected = await recallContext(hybridAgent, 'hello')
    console.log(`\n  recallContext("hello") injects ${injected.split('\n').filter(l => l.startsWith('- ')).length} memories into the turn`)
    report.quality = out
}

type Check = { name: string; expect: string; run: () => Promise<{ pass: boolean; detail: string }> }

function robustnessChecks(): Check[] {
    return [
        {
            name: 'content round-trip',
            expect: 'what is written is what is read back, whatever the text',
            run: async () => {
                hub.setMode('none')
                const agent = makeAgent('roundtrip')
                const samples: Record<string, string> = {
                    'front-matter fence': '---\ntitle: fake\n---\nreal body after a fake front matter',
                    'yaml-looking': 'key: value\nother: [1, 2]',
                    'horizontal rule inside': 'first part\n---\nsecond part',
                    'emoji + cjk + rtl': 'Client 🚀 東京 مرحبا Ελληνικά',
                    'sql-looking': `Robert'); DROP TABLE memories;-- "quoted" 'single'`,
                    'markdown': '# Title\n\n- item **bold**\n\n```js\nconst a = 1\n```',
                    'windows newlines': 'line one\r\nline two',
                    '100 KB': 'lorem ipsum dolor sit amet '.repeat(4000).trim(),
                }
                const broken: string[] = []
                for (const [label, content] of Object.entries(samples)) {
                    const id = await writeMemory(agent, content)
                    const file = (await listMemoryFiles(agent.id)).find(f => f.id === id)
                    if (file?.content !== content.trim()) broken.push(label)
                }
                return { pass: broken.length === 0, detail: broken.length ? `altered: ${broken.join(', ')}` : `${Object.keys(samples).length} samples intact` }
            },
        },
        {
            name: 'hostile search queries',
            expect: 'FTS never throws on operators, quotes or very long input',
            run: async () => {
                hub.setMode('none')
                const agent = makeAgent('hostile-query')
                await writeMemory(agent, 'the invoices live in quickbooks')
                const queries = ['"unterminated', 'AND OR NOT', 'NEAR(a b)', '*', 'content:quickbooks', 'a', '   ', "o'brien", 'quickbooks '.repeat(3000), '-- ; DROP']
                const thrown: string[] = []
                for (const q of queries) await ftsRecall(agent.id, q, 5).catch(() => thrown.push(q.slice(0, 20)))
                return { pass: thrown.length === 0, detail: thrown.length ? `threw on: ${thrown.join(' | ')}` : `${queries.length} queries handled` }
            },
        },
        {
            name: 'non-English keyword recall without embeddings',
            expect: 'a word with an accent or in a non-Latin script finds the memory that contains it',
            run: async () => {
                hub.setMode('none')
                const agent = makeAgent('non-ascii')
                const cases: [string, string][] = [
                    ['La comptabilité est externalisée à Lyon.', 'comptabilité'],
                    ['Le client préfère être appelé le matin.', 'préfère'],
                    ['Os clientes pagam por Pix em São Paulo.', 'São'],
                    ['Der Geschäftsführer heißt Jürgen Müller.', 'Müller'],
                    ['Офис находится в Москве.', 'Москве'],
                    ['東京オフィスの担当者は田中さん', '田中'],
                    ['المكتب الرئيسي في دبي', 'دبي'],
                ]
                const missed: string[] = []
                for (const [content, query] of cases) {
                    const id = await writeMemory(agent, content)
                    const hits = await recallMemory(agent, query, 5, { reinforce: 'none' })
                    if (!hits.some(h => h.id === id)) missed.push(query)
                }
                return { pass: missed.length === 0, detail: missed.length ? `${missed.length}/${cases.length} not found: ${missed.join(', ')}` : 'all found' }
            },
        },
        {
            name: 'hub down during write',
            expect: 'the memory is saved and still found by keyword',
            run: async () => {
                hub.setMode('down')
                const agent = makeAgent('hub-down')
                const id = await writeMemory(agent, 'the payroll runs on gusto')
                const hits = await recallMemory(agent, 'gusto', 5, { reinforce: 'none' })
                return { pass: hits.some(h => h.id === id), detail: 'saved without a vector, keyword recall works' }
            },
        },
        {
            name: 'hub hanging',
            expect: 'a write or a recall is not held hostage for long',
            run: async () => {
                hub.setMode('hang')
                const agent = makeAgent('hub-hang')
                const write = await timed(() => writeMemory(agent, 'the payroll runs on gusto'))
                const recall = await timed(() => recallContext(agent, 'who runs payroll'))
                hub.setMode('real')
                return { pass: write.elapsed < 1500 && recall.elapsed < 1500, detail: `write blocked ${(write.elapsed / 1000).toFixed(1)} s, per-turn recall blocked ${(recall.elapsed / 1000).toFixed(1)} s (added to every chat turn while the hub hangs)` }
            },
        },
        {
            name: 'update while the hub is down',
            expect: 'the old vector does not keep answering for the new content',
            run: async () => {
                hub.setMode('real')
                const agent = makeAgent('stale-vector')
                const id = await writeMemory(agent, 'The office dog is called Biscuit.')
                await writeMemory(agent, 'The newsletter goes out on Thursdays.')
                await writeMemory(agent, 'The backend is written in Elixir.')
                hub.setMode('down')
                await updateMemory(agent, id, 'The quarterly budget review is on the 12th.')
                hub.setMode('real')
                const dog = await vectorRecall(agent.id, await hub.embed('what is the name of the office dog'), 3)
                const budget = await vectorRecall(agent.id, await hub.embed('when is the budget review'), 3)
                const dogScore = dog.find(h => h.id === id)?.score ?? 0
                const budgetScore = budget.find(h => h.id === id)?.score ?? 0
                return {
                    pass: budgetScore > dogScore,
                    detail: `memory now says "budget review" but its vector still matches "office dog" at ${dogScore.toFixed(2)} versus ${budgetScore.toFixed(2)} for its real content`,
                }
            },
        },
        {
            name: 'embedding of the wrong size',
            expect: 'the write either fully succeeds or leaves nothing behind',
            run: async () => {
                hub.setMode('wrong-dims')
                const agent = makeAgent('wrong-dims')
                const error = await writeMemory(agent, 'the invoices live in quickbooks').then(
                    () => null,
                    e => String(e)
                )
                hub.setMode('none')
                const files = (await listMemoryFiles(agent.id)).length
                const rows = await count(agent.id, 'memories')
                const recalled = (await recallMemory(agent, 'quickbooks', 5, { reinforce: 'none' })).length
                const consistent = files === rows
                return { pass: consistent, detail: `write ${error ? 'threw' : 'succeeded'}; files=${files} rows=${rows} recallable=${recalled}${consistent ? '' : ' -> orphan file: listed in the prompt index and the UI, never recalled'}` }
            },
        },
        {
            name: 'very long memory gets a vector',
            expect: 'a memory beyond the embedding model limit is still semantically searchable',
            run: async () => {
                hub.setMode('real')
                const agent = makeAgent('long-memory')
                const id = await writeMemory(agent, `Meeting transcript. ${'The team discussed the roadmap, the hiring plan and the budget in detail. '.repeat(900)}`)
                const { client } = await getSystemDb(agent.id)
                const row = (await client.execute({ sql: 'SELECT embedding IS NOT NULL AS has_vec FROM memories WHERE id = ?', args: [id] })).rows[0]
                const hasVector = Number(row?.has_vec) === 1
                return { pass: hasVector, detail: hasVector ? 'vector stored' : '~13k tokens: embedding refused upstream, stored keyword-only with no warning to the agent' }
            },
        },
        {
            name: 'clear all memories',
            expect: 'nothing is left in any index',
            run: async () => {
                hub.setMode('none')
                const agent = makeAgent('clear-all')
                for (const content of ['alpha fact', 'beta fact', 'gamma fact']) await writeMemory(agent, content)
                await deleteAllMemories(agent)
                const rows = await count(agent.id, 'memories')
                const fts = await count(agent.id, 'memories_fts')
                return { pass: rows === 0 && fts === 0, detail: `rows=${rows}, fts rows=${fts}${fts ? ' (orphaned, the content stays on disk in the FTS table)' : ''}` }
            },
        },
        {
            name: '25 concurrent writes',
            expect: 'every memory lands in the file store and both indexes',
            run: async () => {
                hub.setMode('none')
                const agent = makeAgent('concurrent')
                await Promise.all(Array.from({ length: 25 }, (_, i) => writeMemory(agent, `concurrent fact number ${i}`)))
                const files = (await listMemoryFiles(agent.id)).length
                const rows = await count(agent.id, 'memories')
                const fts = await count(agent.id, 'memories_fts')
                return { pass: files === 25 && rows === 25 && fts === 25, detail: `files=${files} rows=${rows} fts=${fts}` }
            },
        },
        {
            name: 'same fact written twice at once',
            expect: 'one memory, not two',
            run: async () => {
                hub.setMode('none')
                const agent = makeAgent('dup-race')
                await Promise.all([reconcileWrite(agent, 'The CEO is Tobias Lindqvist.', 'fact', []), reconcileWrite(agent, 'The CEO is Tobias Lindqvist.', 'fact', [])])
                const parallel = (await listMemoryFiles(agent.id)).length
                const sequential = makeAgent('dup-seq')
                await reconcileWrite(sequential, 'The CEO is Tobias Lindqvist.', 'fact', [])
                await reconcileWrite(sequential, 'The CEO is Tobias Lindqvist.', 'fact', [])
                const inSequence = (await listMemoryFiles(sequential.id)).length
                return { pass: parallel === 1 && inSequence === 1, detail: `in sequence: ${inSequence} memory, in parallel (two tool calls in one step): ${parallel} memories` }
            },
        },
        {
            name: 'path traversal through a memory id',
            expect: 'an id cannot reach a file outside the memory folder',
            run: async () => {
                hub.setMode('none')
                const agent = makeAgent('traversal')
                await writeMemory(agent, 'anchor')
                const canary = resolve(dataDir, 'agents', agent.id, 'canary.md')
                await writeFile(canary, 'do not touch')
                await deleteMemory(agent, '../canary').catch(() => {})
                const updateRejected = await updateMemory(agent, '../canary', 'overwritten').then(
                    () => false,
                    () => true
                )
                const intact = existsSync(canary) && (await readMemoryFile(canary).catch(() => null))?.content === 'do not touch'
                return { pass: intact && updateRejected, detail: intact && updateRejected ? 'delete and update both refused' : 'file outside the folder was reached' }
            },
        },
        {
            name: 'agents are isolated',
            expect: "one agent never recalls another agent's memory",
            run: async () => {
                hub.setMode('real')
                const a = makeAgent('iso-a')
                const b = makeAgent('iso-b')
                await writeMemory(a, 'The secret launch date is October 14.')
                await writeMemory(b, 'The backend is written in Elixir.')
                const leak = (await recallMemory(b, 'secret launch date', 5, { reinforce: 'none' })).some(m => m.content.includes('October 14'))
                return { pass: !leak, detail: leak ? 'LEAK' : 'separate database per agent' }
            },
        },
        {
            name: 'memory file created by hand',
            expect: 'a file the agent drops in its memory folder is searchable, or not advertised',
            run: async () => {
                hub.setMode('none')
                const agent = makeAgent('drift-handmade')
                await writeMemory(agent, 'anchor fact about invoices')
                const dir = resolve(dataDir, 'agents', agent.id, 'memory')
                await mkdir(dir, { recursive: true })
                await writeFile(resolve(dir, 'handmade.md'), '---\nid: handmade\nkind: fact\ntags: []\ncreatedAt: 2026-10-01T00:00:00.000Z\n---\n\nThe warehouse is in Antwerp.\n')
                const inIndex = (await buildMemoryIndex(agent.id)).includes('Antwerp')
                const recalled = (await recallMemory(agent, 'warehouse Antwerp', 5, { reinforce: 'none' })).some(m => m.content.includes('Antwerp'))
                return { pass: inIndex === recalled, detail: `listed in the prompt index: ${inIndex}, found by memory_recall: ${recalled}` }
            },
        },
        {
            name: 'memory file removed by hand',
            expect: 'a memory whose file is gone is gone everywhere',
            run: async () => {
                hub.setMode('none')
                const agent = makeAgent('drift-removed')
                const id = await writeMemory(agent, 'The warehouse is in Antwerp.')
                await rm(resolve(dataDir, 'agents', agent.id, 'memory', `${id}.md`))
                const listed = (await listMemoryFiles(agent.id)).some(f => f.id === id)
                const recalled = (await recallMemory(agent, 'warehouse', 5, { reinforce: 'none' })).some(m => m.id === id)
                return { pass: listed === recalled, detail: `shown in the Memories tab: ${listed}, still recalled into runs: ${recalled}${recalled && !listed ? ' -> ghost the user can neither see nor delete' : ''}` }
            },
        },
        {
            name: 'memory file edited by hand',
            expect: 'search follows the edited content',
            run: async () => {
                hub.setMode('none')
                const agent = makeAgent('drift-edited')
                const id = await writeMemory(agent, 'The warehouse is in Antwerp.')
                const path = resolve(dataDir, 'agents', agent.id, 'memory', `${id}.md`)
                await writeFile(path, `---\nid: ${id}\nkind: note\ntags: []\ncreatedAt: 2026-10-01T00:00:00.000Z\n---\n\nThe warehouse moved to Ghent.\n`)
                const byNew = (await recallMemory(agent, 'Ghent', 5, { reinforce: 'none' })).some(m => m.id === id)
                const byOld = (await recallMemory(agent, 'Antwerp', 5, { reinforce: 'none' })).some(m => m.id === id)
                return { pass: byNew && !byOld, detail: `found by new word: ${byNew}, still found by the removed word: ${byOld}` }
            },
        },
        {
            name: 'decay: unused task goes dormant',
            expect: 'a 10-day-old task is hidden from recall and the index, reachable with includeDormant',
            run: async () => {
                hub.setMode('none')
                const agent = makeAgent('decay-dormant')
                const id = await writeMemory(agent, 'Call the plumber about the leak.', 'task')
                await writeMemory(agent, 'The office is in Rotterdam.', 'fact')
                await age(agent.id, id, 240)
                const normal = (await recallMemory(agent, 'plumber leak', 5, { reinforce: 'none' })).some(m => m.id === id)
                const dormant = (await recallMemory(agent, 'plumber leak', 5, { reinforce: 'none', includeDormant: true })).some(m => m.id === id)
                const index = await buildMemoryIndex(agent.id)
                const pass = !normal && dormant && !index.includes('plumber') && index.includes('1 dormant memory')
                return { pass, detail: `default recall: ${normal}, includeDormant: ${dormant}, index mentions the dormant count: ${index.includes('1 dormant memory')}` }
            },
        },
        {
            name: 'decay: sweep archives a dead memory',
            expect: 'file moved to archive/, row and FTS entry removed',
            run: async () => {
                hub.setMode('none')
                const agent = makeAgent('decay-sweep')
                const id = await writeMemory(agent, 'Call the plumber about the leak.', 'task')
                await age(agent.id, id, 480)
                const archived = await sweepAgentMemories(agent.id)
                const moved = existsSync(resolve(dataDir, 'agents', agent.id, 'memory', 'archive', `${id}.md`))
                const rows = await count(agent.id, 'memories')
                const fts = await count(agent.id, 'memories_fts')
                return { pass: archived === 1 && moved && rows === 0 && fts === 0, detail: `archived=${archived} moved=${moved} rows=${rows} fts=${fts}` }
            },
        },
        {
            name: 'decay: an unrelated message does not refresh memories',
            expect: 'saying "hello" does not reset the clock of memories that have nothing to do with it',
            run: async () => {
                hub.setMode('real')
                const agent = makeAgent('decay-touch')
                const ids: string[] = []
                for (const content of ['Call the plumber about the leak.', 'Send the Q3 deck to the board.', 'Renew the domain brightloom.io.', 'Order new business cards.']) ids.push(await writeMemory(agent, content, 'task'))
                for (const id of ids) await age(agent.id, id, 120)
                const before = (await listMemories(agent.id)).map(r => computeStrength(r))
                await recallContext(agent, 'hello, how are you today?')
                const after = (await listMemories(agent.id)).map(r => computeStrength(r))
                const refreshed = after.filter(s => s > 0.99).length
                return { pass: refreshed === 0, detail: `strength before ${before.map(s => s.toFixed(2)).join('/')}, after one "hello": ${after.map(s => s.toFixed(2)).join('/')} (${refreshed}/4 reset to full strength)` }
            },
        },
        {
            name: 'decay: an agent that is chatted with can still forget',
            expect: 'with 30 daily unrelated turns, an unused task memory eventually goes dormant',
            run: async () => {
                hub.setMode('real')
                const agent = makeAgent('decay-never')
                const ids: string[] = []
                for (const content of ['Call the plumber about the leak.', 'Send the Q3 deck to the board.', 'Renew the domain brightloom.io.']) ids.push(await writeMemory(agent, content, 'task'))
                const { client } = await getSystemDb(agent.id)
                for (let day = 0; day < 30; day++) {
                    await client.execute({ sql: "UPDATE memories SET last_accessed_at = strftime('%Y-%m-%dT%H:%M:%fZ', last_accessed_at, '-1 day'), created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '-1 day')", args: [] })
                    await recallContext(agent, 'thanks, anything else on your side?')
                }
                const strengths = (await listMemories(agent.id)).map(r => computeStrength(r))
                const dormant = strengths.filter(s => s < 0.15).length
                return { pass: dormant === ids.length, detail: `after 30 simulated days of unrelated chat: ${dormant}/${ids.length} dormant, strengths ${strengths.map(s => s.toFixed(2)).join('/')} (task half-life is 3 days)` }
            },
        },
    ]
}

async function robustnessSuite(): Promise<void> {
    console.log('\n=== 2. ROBUSTNESS ===')
    const results: { name: string; expect: string; pass: boolean; detail: string }[] = []
    for (const check of robustnessChecks()) {
        const outcome = await check.run().catch(err => ({ pass: false, detail: `threw: ${String(err).slice(0, 200)}` }))
        results.push({ name: check.name, expect: check.expect, ...outcome })
        console.log(`  ${outcome.pass ? 'PASS' : 'FAIL'}  ${check.name}\n        ${outcome.detail}`)
    }
    hub.setMode('real')
    console.log(`\n  ${results.filter(r => r.pass).length}/${results.length} checks pass`)
    report.robustness = results
}

const SUBJECTS = ['The Lisbon office', 'Norvik Logistics', 'The finance team', 'Our reseller in Madrid', 'The support lead', 'The Berlin warehouse', 'The design agency', 'The Growth plan', 'The onboarding flow', 'The partner portal']
const VERBS = ['switched to', 'renewed', 'cancelled', 'asked about', 'complained about', 'approved', 'postponed', 'doubled', 'audited', 'migrated']
const OBJECTS = ['the annual contract', 'the invoicing tool', 'the shipping provider', 'the reporting dashboard', 'the security review', 'the pricing page', 'the data export', 'the support SLA', 'the training budget', 'the API quota']

function syntheticFact(i: number): string {
    return `${SUBJECTS[i % 10]} ${VERBS[Math.floor(i / 10) % 10]} ${OBJECTS[Math.floor(i / 100) % 10]} under reference REF${String(i).padStart(5, '0')}.`
}

async function scaleSuite(): Promise<void> {
    console.log('\n=== 3. SCALE (synthetic embeddings, one agent growing) ===')
    hub.setMode('synthetic')
    const agent = makeAgent('scale')
    const ids: string[] = []
    const rows: Record<string, unknown>[] = []
    console.log('  memories   write p50    write p95   recall p50   recall p95   exact hit@1   ref hit@1   index build   index size (always in the system prompt)')
    for (const target of scaleSteps) {
        const writes: number[] = []
        while (ids.length < target) {
            const { value, elapsed } = await timed(() => writeMemory(agent, syntheticFact(ids.length), 'fact'))
            ids.push(value)
            writes.push(elapsed)
        }
        const recalls: number[] = []
        let exactHits = 0
        let refHits = 0
        const samples = 40
        for (let s = 0; s < samples; s++) {
            const i = Math.floor(((s + 0.5) / samples) * ids.length)
            const exact = await timed(() => recallMemory(agent, syntheticFact(i), 5, { reinforce: 'none' }))
            recalls.push(exact.elapsed)
            if (exact.value[0]?.id === ids[i]) exactHits++
            const byRef = await recallMemory(agent, `REF${String(i).padStart(5, '0')}`, 5, { reinforce: 'none' })
            if (byRef[0]?.id === ids[i]) refHits++
        }
        const index = await timed(() => buildMemoryIndex(agent.id))
        const dbBytes = statSync(resolve(dataDir, 'agents', agent.id, 'data', 'system.db')).size
        const row = {
            memories: target,
            writeP50: quantile(writes.slice(-200), 0.5),
            writeP95: quantile(writes.slice(-200), 0.95),
            recallP50: quantile(recalls, 0.5),
            recallP95: quantile(recalls, 0.95),
            exactHit1: exactHits / samples,
            refHit1: refHits / samples,
            indexBuildMs: index.elapsed,
            indexChars: index.value.length,
            indexTokensApprox: Math.round(index.value.length / 4),
            dbBytes,
        }
        rows.push(row)
        console.log(
            `  ${String(target).padStart(8)}   ${ms(row.writeP50).padStart(9)}   ${ms(row.writeP95).padStart(9)}   ${ms(row.recallP50).padStart(10)}   ${ms(row.recallP95).padStart(10)}   ${pct(exactHits, samples).padStart(11)}   ${pct(refHits, samples).padStart(9)}   ${ms(row.indexBuildMs).padStart(11)}   ${row.indexChars.toLocaleString()} chars ≈ ${row.indexTokensApprox.toLocaleString()} tokens, db ${(dbBytes / 1e6).toFixed(1)} MB`
        )
    }
    hub.setMode('real')
    report.scale = rows
}

async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const out: R[] = []
    for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))))
    return out
}

async function llmSuite(): Promise<void> {
    console.log('\n=== 4. LLM DECISIONS (real model through OpenRouter, real embeddings) ===')
    hub.setMode('real')
    const out: Record<string, unknown> = {}
    for (const model of models) {
        console.log(`\n  model: ${model}`)
        const callsBefore = chatCalls

        const reconcile = await inBatches(RECONCILE_CASES, 4, async c => {
            const agent = makeAgent('reconcile', model)
            const ids = await seed(agent, c.seed)
            const { value, elapsed } = await timed(() => reconcileWrite(agent, c.write, 'fact', []).catch(e => ({ error: String(e) })))
            const files = await listMemoryFiles(agent.id)
            let pass = false
            let got = 'error' in value ? `error: ${value.error.slice(0, 120)}` : value.updated ? `updated ${[...ids].find(([, id]) => id === value.id)?.[0] ?? '?'}` : 'new'
            if (!('error' in value)) {
                if (c.expect === 'new') pass = !value.updated && files.length === c.seed.length + 1
                else pass = value.updated && value.id === ids.get(c.expect.update) && files.length === c.seed.length
            }
            if (files.length !== c.seed.length + (c.expect === 'new' ? 1 : 0)) got += ` (${files.length} memories on disk)`
            return { name: c.name, expect: c.expect === 'new' ? 'new' : `update ${c.expect.update}`, got, pass, elapsed }
        })
        console.log('  memory_write reconcile (does a new fact overwrite the one it supersedes, and only that one)')
        for (const r of reconcile) console.log(`    ${r.pass ? 'PASS' : 'FAIL'}  ${r.name.padEnd(34)} expected ${r.expect.padEnd(9)} got ${r.got}  (${(r.elapsed / 1000).toFixed(1)} s)`)
        const reconcileCalls = chatCalls - callsBefore
        console.log(`    ${reconcile.filter(r => r.pass).length}/${reconcile.length} correct, median ${(quantile(reconcile.map(r => r.elapsed), 0.5) / 1000).toFixed(1)} s per memory_write, ${reconcileCalls} LLM calls for ${reconcile.length} writes`)

        const curatorCallsBefore = chatCalls
        const curator = await inBatches(CURATOR_CASES, 4, async c => {
            const agent = makeAgent('curator', model)
            const ids = await seed(agent, c.seed)
            const before = new Map((await listMemoryFiles(agent.id)).map(f => [f.id, f.content]))
            const { value: error, elapsed } = await timed(() =>
                runCurator(agent, 'bench-session', c.user, c.assistant).then(
                    () => null,
                    e => String(e)
                )
            )
            const after = await listMemoryFiles(agent.id)
            const added = after.filter(f => !before.has(f.id))
            const changed = after.filter(f => before.has(f.id) && before.get(f.id) !== f.content)
            const removed = [...before.keys()].filter(id => !after.some(f => f.id === id))
            let got = error ? `error: ${error.slice(0, 120)}` : 'nothing'
            if (!error && (added.length || changed.length || removed.length)) got = [added.length ? `new x${added.length}` : '', changed.length ? `updated x${changed.length}` : '', removed.length ? `deleted x${removed.length}` : ''].filter(Boolean).join(' + ')
            let pass = false
            if (!error) {
                if (c.expect === 'nothing') pass = added.length === 0 && changed.length === 0 && removed.length === 0
                else if (c.expect === 'new') pass = added.length === 1 && changed.length === 0 && removed.length === 0
                else {
                    const target = ids.get('update' in c.expect ? c.expect.update : c.expect.obsolete)!
                    const superseded = changed.some(f => f.id === target) || (removed.includes(target) && added.length === 1)
                    pass = superseded && after.length === c.seed.length
                }
            }
            const leaked = c.mustNotContain ? after.some(f => f.content.includes(c.mustNotContain!)) : false
            if (leaked) {
                pass = false
                got += ' (SECRET STORED IN PLAIN TEXT)'
            }
            const stored = [...added, ...changed].map(f => f.content.replace(/\s+/g, ' ').slice(0, 110))
            return { name: c.name, expect: typeof c.expect === 'string' ? c.expect : 'supersede seed', got, pass, elapsed, stored }
        })
        console.log('  auto-memory curator (what the engine decides to remember after each turn, with no tool call)')
        for (const r of curator) {
            console.log(`    ${r.pass ? 'PASS' : 'FAIL'}  ${r.name.padEnd(38)} expected ${r.expect.padEnd(14)} got ${r.got}  (${(r.elapsed / 1000).toFixed(1)} s)`)
            for (const line of r.stored) console.log(`            stored: "${line}"`)
        }
        console.log(`    ${curator.filter(r => r.pass).length}/${curator.length} correct, median ${(quantile(curator.map(r => r.elapsed), 0.5) / 1000).toFixed(1)} s, ${chatCalls - curatorCallsBefore} LLM calls`)
        out[model] = { reconcile, curator, reconcileCalls }
    }
    report.llm = out
}

try {
    if (suites.has('quality')) await qualitySuite()
    if (suites.has('robustness')) await robustnessSuite()
    if (suites.has('scale')) await scaleSuite()
    if (suites.has('llm')) await llmSuite()
} catch (err) {
    console.error('benchmark aborted:', err)
    process.exitCode = 1
} finally {
    mkdirSync(outDir, { recursive: true })
    const file = resolve(outDir, `results-${[...suites].join('+')}.json`)
    writeFileSync(file, JSON.stringify(report, null, 2))
    console.log(`\nresults written to ${file}`)
    hub.close()
    await rm(dataDir, { recursive: true, force: true })
    process.exit()
}
