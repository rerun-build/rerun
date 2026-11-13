import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { createReadStream, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, relative, resolve, sep } from 'node:path'
import type { Readable } from 'node:stream'
import { create } from 'tar'
import {
    CONNECTION_ENV_KEYS,
    parseServiceRegistryKey,
    scanPathForSecrets,
    scanTextForSecrets,
    type AgentArchiveEntry,
    type AgentArchiveMcpAuth,
    type AgentArchivePlan,
    type AgentArchiveRedaction,
    type McpServer,
} from '@rerun/contracts'
import { agentDir, mcpDir } from '../config/paths.js'
import type { AgentConfig, LoadedAgent } from './types.js'
import { getAgent } from './registry.js'
import { serializeEnv } from './env.js'
import { listSkills } from '../skills/loader.js'
import { listSchedules } from '../schedules/loader.js'
import { isSafeSlug as isSafeTriggerSlug, listTriggers, readTrigger, redactTriggerForArchive } from '../triggers/loader.js'
import { checkpointAgentDb } from '../db/agentDb.js'
import { buildCommit } from '../runtime/build-info.js'
import { badRequest } from '../lib/errors.js'
import { readRegistry, type RegistryEntry, type ServiceRegistry } from '../services/registry.js'
import { registryWithVault, withVaultFolded } from '../vault/archive-view.js'
import { VAULT_SKILLS_MARKER } from '../vault/skills.js'

// An allowlist, not a denylist: anything an agent folder gains later stays out of the archive
// until someone adds it here on purpose. The goal is a copy as complete as the original, so what
// stays out is only what cannot travel without carrying someone's credentials or history:
// `mcp/` (OAuth bundles) and `data/system.db` (transcripts, tool-call arguments, telemetry).
// `data/agent.db` is the agent's own tables, built by its db_* tools, so it is behaviour.
// `triggers/` travels redacted: a webhook is behaviour, its token is not, so the file ships with
// an empty one and the receiving engine mints a URL of its own.
export const ARCHIVE_ROOTS = ['SOUL.md', 'INSTALL.md', 'config.json', '.env', 'skills', 'schedules', 'triggers', 'workspace', 'memory', 'data/agent.db'] as const

const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', '.next', 'dist', '.cache', '.pytest_cache', '.turbo'])

// Archived memories are the ones the decay sweep already retired; `listMemoryFiles` hides them
// from the agent too. Paid answers are data the workspace bought (emails, phones), and saved pages
// what it read, not behaviour.
const SKIP_PATHS = new Set(['memory/archive', 'workspace/.rerun/paid-data', 'workspace/.rerun/pages'])
// Which skills a Vault item wrote names the box's items: an archive carries those skills as the
// coworker's own. A duplicate keeps it, or the copy would take them for its own and keep them forever.
const ARCHIVE_SKIP_FILES = new Set([`skills/${VAULT_SKILLS_MARKER}`])

const ENV_PATH = '.env'
const CONFIG_PATH = 'config.json'
const INSTALL_PATH = 'INSTALL.md'
const TRIGGERS_PREFIX = 'triggers/'
const REGISTRY_PATH = 'workspace/.rerun/services.json'
const AGENT_DB_PATH = 'data/agent.db'
export const MANIFEST_PATH = '.rerun-capture.json'

// Re-provisioned by the engine that receives the copy. An empty value would be worse than an
// absent one: `claude-token.ts` reads these back and would try to refresh a blank token. The
// provider credentials moved to box connections, so an agent should no longer carry them at all —
// they stay listed for an archive taken from a box that has not migrated yet.
const ENGINE_MANAGED_KEYS = new Set<string>([...CONNECTION_ENV_KEYS, 'RERUN_API_KEY', 'RERUN_HUB_BASE_URL'])

const MAX_FILE_BYTES = 25 * 1024 * 1024
const MAX_TOTAL_BYTES = 150 * 1024 * 1024
const MAX_SCAN_BYTES = 1024 * 1024

export const ARCHIVE_LIMITS = { maxFileBytes: MAX_FILE_BYTES, maxTotalBytes: MAX_TOTAL_BYTES }

// Any `${...}` span, `${agent.id}` included, which the engine's own resolver would reject for its
// dot. Removing them is how a value gets judged on what is left, not on what it references.
const PLACEHOLDER = /\$\{[^}]*\}/g
const LONG_TOKEN = /[A-Za-z0-9_-]{24,}/

const BINARY_EXTENSIONS = new Set([
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'bmp', 'tiff',
    'pdf', 'zip', 'gz', 'tar', 'bz2', 'xz', '7z', 'rar',
    'mp3', 'mp4', 'wav', 'mov', 'avi', 'webm', 'ogg',
    'db', 'sqlite', 'sqlite3', 'wasm', 'so', 'dylib', 'dll', 'exe',
    'woff', 'woff2', 'ttf', 'otf', 'eot',
])

function isBinary(path: string): boolean {
    const ext = path.split('.').pop()
    return ext ? BINARY_EXTENSIONS.has(ext.toLowerCase()) : false
}

async function walk(root: string, prefix: string, out: string[]): Promise<void> {
    const entries = await readdir(resolve(root, prefix), { withFileTypes: true })
    for (const entry of entries) {
        const path = `${prefix}/${entry.name}`
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name) || SKIP_PATHS.has(path)) continue
            await walk(root, path, out)
        } else if (entry.isFile() && !entry.name.endsWith('.tmp')) {
            out.push(path)
        }
    }
}

// Generalised over the roots because duplication walks a wider set than a capture does: a copy
// staying on the box keeps its `mcp/` OAuth bundles, which no archive may ever carry.
export async function listPathsUnder(id: string, roots: readonly string[]): Promise<string[]> {
    const root = agentDir(id)
    const paths: string[] = []
    for (const entry of roots) {
        const full = resolve(root, entry)
        if (!existsSync(full)) continue
        if ((await stat(full)).isDirectory()) await walk(root, entry, paths)
        else paths.push(entry)
    }
    return paths.sort()
}

export async function listArchivablePaths(id: string): Promise<string[]> {
    return (await listPathsUnder(id, ARCHIVE_ROOTS)).filter(path => !ARCHIVE_SKIP_FILES.has(path))
}

function sanitizeVar(value: string): string {
    return value.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()
}

// `mcp_register` and PATCH /agents/:id/mcp-servers both accept a literal value where the UI
// compiler would have written a `${VAR}` reference, so config.json has to be treated as
// secret-bearing rather than trusted. What it must NOT do is break a value that only references:
// `Bearer ${RERUN_SVC_X_KEY}` is the shape the compiler emits and the shape the engine's resolver
// expects, so the judgement is made on the residue once every `${...}` is out.
export function scrubConfig(config: AgentConfig, agentId?: string): { config: AgentConfig; strippedKeys: string[] } {
    const strippedKeys: string[] = []

    const scrubValue = (server: McpServer, field: 'env' | 'headers', key: string, value: string): string => {
        if (!value) return value
        // The compiler writes the source agent id into a header so a managed proxy knows who is
        // calling. Not a secret, but not transferable either: hand back the `${agent.id}` token
        // the compiler substitutes at install time.
        const rewritten = agentId ? value.replaceAll(agentId, '${agent.id}') : value
        const residue = rewritten.replace(PLACEHOLDER, '').trim()
        if (!residue || (!LONG_TOKEN.test(residue) && scanTextForSecrets(residue).length === 0)) return rewritten
        strippedKeys.push(`${server.name}.${field}.${key}`)
        return `\${RERUN_SVC_${sanitizeVar(server.name)}_${sanitizeVar(key)}}`
    }

    const scrubRecord = (server: McpServer, field: 'env' | 'headers', record: Record<string, string>) => {
        const out: Record<string, string> = {}
        for (const [key, value] of Object.entries(record)) out[key] = scrubValue(server, field, key, value)
        return out
    }

    const mcpServers = config.mcpServers.map(server => ({
        ...server,
        env: scrubRecord(server, 'env', server.env),
        headers: scrubRecord(server, 'headers', server.headers),
    }))

    // A connection id means nothing on the box that receives the copy. `provider` and `model` are
    // left alone because the capture review reads them off the plan, not because the copy runs on
    // them: the import drops all three and starts the copy on the receiving box's default.
    // Letting a coworker spend credit without asking is a choice its owner made for their own
    // workspace, never one a copy carries to someone else's.
    return { config: { ...config, mcpServers, connectionId: null, paidDataAlwaysAllow: false }, strippedKeys }
}

// The copy holds each connector's shape but neither its secrets nor its tokens, so leaving an
// entry `active` would have the agent claim tools it cannot reach. Account labels and emails name
// the original owner's accounts, not the ones the copy will connect, so a label that is one of
// them goes too; an ordinal label ("Gmail 2") stays, it is what tells two accounts apart.
function redactRegistry(registry: ServiceRegistry): { content: string; reason: string } {
    const services: Record<string, RegistryEntry> = {}
    let reset = 0
    for (const [key, entry] of Object.entries(registry.services ?? {})) {
        const status = entry.oauth || entry.managed ? 'needs_auth' : entry.envKeys?.length ? 'needs_config' : (entry.status ?? 'active')
        if (status !== entry.status) reset += 1
        const managed = entry.managed && withoutKey(entry.managed, 'accountEmail')
        const composio = entry.composio && withoutKey(entry.composio, 'accountLabel')
        const ownerLabel = entry.managed?.accountEmail ?? entry.composio?.accountLabel
        const redacted = entry.label && entry.label === ownerLabel ? withoutKey(entry, 'label') : entry
        services[key] = { ...redacted, status, ...(managed ? { managed } : {}), ...(composio ? { composio } : {}) }
    }
    const reason = reset > 0 ? `${reset} app${reset === 1 ? '' : 's'} reset to needs_auth or needs_config` : ''
    return { content: `${JSON.stringify({ ...registry, services }, null, 2)}\n`, reason }
}

function withoutKey<T extends object>(value: T, omitted: string): T {
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== omitted)) as T
}

// The catalog apps the agent uses, one per app however many accounts it holds.
export function registryConnectorSlugs(registry: ServiceRegistry | null): string[] {
    return [...new Set(Object.keys(registry?.services ?? {}).map(key => parseServiceRegistryKey(key).slug))].sort()
}

function placeholdersIn(config: AgentConfig): string[] {
    const values: string[] = []
    for (const server of config.mcpServers) {
        values.push(server.command ?? '', server.url ?? '', ...server.args, ...Object.values(server.env), ...Object.values(server.headers))
    }
    return values.flatMap(value => [...value.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map(match => match[1]))
}

export function requiredEnvKeys(agent: LoadedAgent): string[] {
    const keys = new Set([...Object.keys(agent.env), ...placeholdersIn(agent.config)])
    return [...keys].filter(key => !ENGINE_MANAGED_KEYS.has(key)).sort()
}

export async function mcpAuthServers(id: string, registry: ServiceRegistry | null): Promise<AgentArchiveMcpAuth[]> {
    const kinds = new Map<string, AgentArchiveMcpAuth['kind']>()
    for (const entry of Object.values(registry?.services ?? {})) {
        if (entry.oauth?.serverName) kinds.set(entry.oauth.serverName, 'oauth')
        if (entry.managed?.serverName) kinds.set(entry.managed.serverName, 'managed')
    }

    const dir = mcpDir(id)
    if (existsSync(dir)) {
        for (const name of await readdir(dir)) {
            if (!name.endsWith('.json') || name.endsWith('.pending.json')) continue
            const server = name.slice(0, -'.json'.length)
            if (!kinds.has(server)) kinds.set(server, 'unknown')
        }
    }

    return [...kinds].map(([server, kind]) => ({ server, kind })).sort((a, b) => a.server.localeCompare(b.server))
}

type Redaction = { content: string; reason: string }

// One place decides what a redacted file contains, so the plan sizes and scans exactly the bytes
// the tarball will carry. Returns null for a file that travels untouched.
async function redactionFor(id: string, path: string, agent: LoadedAgent): Promise<Redaction | null> {
    if (path === ENV_PATH) {
        const keys = Object.keys(agent.env)
            .filter(key => !ENGINE_MANAGED_KEYS.has(key))
            .sort()
        const blanked = Object.fromEntries(keys.map(key => [key, '']))
        return {
            content: keys.length > 0 ? `${serializeEnv(blanked)}\n` : '',
            reason: `${keys.length} key${keys.length === 1 ? '' : 's'} kept, every value cleared`,
        }
    }

    if (path === CONFIG_PATH) {
        const { config, strippedKeys } = scrubConfig(agent.config, id)
        const reason = strippedKeys.length > 0 ? `${strippedKeys.length} literal value${strippedKeys.length === 1 ? '' : 's'} replaced by a reference` : ''
        return { content: `${JSON.stringify(config, null, 2)}\n`, reason }
    }

    if (path.startsWith(TRIGGERS_PREFIX)) {
        const slug = path.slice(TRIGGERS_PREFIX.length).replace(/\.md$/, '')
        // A file the loader would not read back is not a trigger: it travels as it is rather than
        // being rewritten from a parse that never happened.
        if (!isSafeTriggerSlug(slug) || !path.endsWith('.md')) return null
        return { content: redactTriggerForArchive(await readTrigger(id, slug)), reason: 'webhook secret dropped, the copy is issued a URL of its own' }
    }

    if (path === REGISTRY_PATH) {
        const registry = registryWithVault(agent, await readRegistry(id))
        return registry ? redactRegistry(registry) : null
    }

    return null
}

type ResolvedEntry = { path: string; bytes: number; redaction: Redaction | null }

async function resolveEntries(id: string, agent: LoadedAgent, exclude: string[]): Promise<ResolvedEntry[]> {
    const root = agentDir(id)
    const excluded = new Set(exclude)
    const entries: ResolvedEntry[] = []

    const paths = await listArchivablePaths(id)
    for (const path of paths) {
        if (excluded.has(path)) continue
        const redaction = await redactionFor(id, path, agent)
        const bytes = redaction ? Buffer.byteLength(redaction.content, 'utf8') : (await stat(resolve(root, path))).size
        entries.push({ path, bytes, redaction })
    }
    // A coworker holding keys or accounts only through the Vault has no file of its own for them.
    for (const path of [ENV_PATH, REGISTRY_PATH]) {
        if (paths.includes(path) || excluded.has(path)) continue
        const redaction = await redactionFor(id, path, agent)
        if (redaction?.content) entries.push({ path, bytes: Buffer.byteLength(redaction.content, 'utf8'), redaction })
    }
    entries.sort((a, b) => a.path.localeCompare(b.path))

    return entries
}

async function scanFile(root: string, path: string, bytes: number): Promise<string[]> {
    if (isBinary(path) || bytes > MAX_SCAN_BYTES) return []
    try {
        return scanTextForSecrets(await readFile(resolve(root, path), 'utf8'))
    } catch {
        return []
    }
}

function noteFor(path: string, redaction: Redaction | null): string {
    if (redaction?.reason) return redaction.reason
    if (path.startsWith('memory/')) return 'memory'
    if (path === AGENT_DB_PATH) return 'agent database'
    if (path === INSTALL_PATH) return 'setup instructions replayed on the copy'
    return ''
}

export async function planArchive(id: string, exclude: string[] = []): Promise<AgentArchivePlan> {
    const agent = withVaultFolded(await getAgent(id))
    const root = agentDir(id)
    const registry = registryWithVault(agent, await readRegistry(id))

    const files: AgentArchiveEntry[] = []
    const redactions: AgentArchiveRedaction[] = []
    let totalBytes = 0
    let memoryCount = 0

    for (const { path, bytes, redaction } of await resolveEntries(id, agent, exclude)) {
        // A redacted file is ours: it is scanned on the bytes we rewrote and never flagged on its
        // path, or `.env` would come back unchecked right after we emptied it.
        const flagged = redaction ? scanTextForSecrets(redaction.content) : [...scanPathForSecrets(path), ...(await scanFile(root, path, bytes))]
        if (path.startsWith('memory/')) memoryCount += 1
        if (redaction?.reason) redactions.push({ path, reason: redaction.reason })
        files.push({
            path,
            bytes,
            flagged,
            defaultExcluded: flagged.length > 0 || path.startsWith('memory/'),
            note: noteFor(path, redaction),
        })
        totalBytes += bytes
    }

    const skills = await listSkills(id)
    const schedules = await listSchedules(id)
    const triggers = await listTriggers(id)
    const { strippedKeys } = scrubConfig(agent.config, id)

    return {
        agentId: id,
        name: agent.config.name,
        displayName: agent.config.displayName ?? '',
        description: agent.config.description,
        provider: agent.resolved.provider,
        model: agent.resolved.model,
        tools: Object.entries(agent.config.tools)
            .filter(([, enabled]) => enabled)
            .map(([key]) => key),
        files,
        totalBytes,
        connectorSlugs: registryConnectorSlugs(registry),
        skills: skills.map(({ slug, name, description }) => ({ slug, name, description })),
        schedules: schedules.map(({ slug, name, cron }) => ({ slug, name, cron })),
        triggers: triggers.map(({ slug, name, description, methods, enabled }) => ({ slug, name, description, methods, enabled })),
        strippedConfigKeys: strippedKeys,
        envKeys: requiredEnvKeys(agent),
        mcpAuth: await mcpAuthServers(id, registry),
        redactions,
        memoryCount,
        setup: { required: agent.config.setup.required, completedAt: agent.config.setup.completedAt, prompt: agent.install },
        engineCommit: buildCommit(),
    }
}

// Staged into a temp directory rather than tarred straight out of the agent folder: the archive
// carries redacted bytes for `.env`, `config.json` and the connector registry, and tar reads entry
// contents from disk. Staging also means a run in flight cannot mutate a file halfway through the
// stream.
async function stageArchive(id: string, agent: LoadedAgent, exclude: string[]): Promise<{ staging: string; entries: ResolvedEntry[] }> {
    const root = agentDir(id)
    await checkpointAgentDb(id)

    const entries = await resolveEntries(id, agent, exclude)

    let totalBytes = 0
    for (const { path, bytes } of entries) {
        if (bytes > MAX_FILE_BYTES) throw badRequest(`"${path}" is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB. Exclude it to capture this agent.`)
        totalBytes += bytes
    }
    if (totalBytes > MAX_TOTAL_BYTES) {
        throw badRequest(`This agent weighs ${Math.round(totalBytes / 1024 / 1024)} MB, over the ${MAX_TOTAL_BYTES / 1024 / 1024} MB limit. Exclude its heaviest folders.`)
    }

    const keep = new Set(entries.map(entry => entry.path))

    // Every ancestor of a kept file, so the filter can answer "descend into this directory?"
    // without scanning the whole list per entry.
    const keepDirs = new Set<string>()
    for (const path of keep) {
        const parts = path.split('/')
        for (let i = 1; i < parts.length; i++) keepDirs.add(parts.slice(0, i).join('/'))
    }

    const staging = await mkdtemp(resolve(tmpdir(), 'rerun-archive-'))
    await cp(root, staging, {
        recursive: true,
        filter: source => {
            const rel = relative(root, source).split(sep).join('/')
            return !rel || keep.has(rel) || keepDirs.has(rel)
        },
    })

    for (const { path, redaction } of entries) {
        if (!redaction) continue
        await mkdir(dirname(resolve(staging, path)), { recursive: true })
        await writeFile(resolve(staging, path), redaction.content, 'utf8')
    }

    return { staging, entries }
}

// Written to a file rather than piped straight out: tar returns a Minipass stream, not a
// node stream.Readable, and the response needs a real one. It also gives an exact byte size.
export async function buildArchive(id: string, exclude: string[] = []): Promise<{ stream: Readable; bytes: number }> {
    const agent = withVaultFolded(await getAgent(id))
    const { staging, entries } = await stageArchive(id, agent, exclude)
    const tarball = resolve(staging, '..', `${id}-${Date.now()}.tar.gz`)

    try {
        // The archive has to say what was done to it: a copy read months later cannot re-derive
        // which keys it is missing or which connectors were never authorized.
        const manifest = {
            version: 1,
            sourceAgentId: id,
            engineCommit: buildCommit(),
            capturedAt: new Date().toISOString(),
            envKeys: requiredEnvKeys(agent),
            mcpAuth: await mcpAuthServers(id, registryWithVault(agent, await readRegistry(id))),
            redactions: entries.filter(entry => entry.redaction?.reason).map(entry => ({ path: entry.path, reason: entry.redaction?.reason ?? '' })),
            excludedPaths: [...exclude].sort(),
        }
        await writeFile(resolve(staging, MANIFEST_PATH), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
        await create({ gzip: true, cwd: staging, portable: true, file: tarball }, ['.'])
    } catch (err) {
        await rm(staging, { recursive: true, force: true })
        throw err
    }

    const { size } = await stat(tarball)
    const stream = createReadStream(tarball)
    const cleanup = () => {
        void rm(staging, { recursive: true, force: true })
        void rm(tarball, { force: true })
    }
    stream.on('close', cleanup)
    stream.on('error', cleanup)

    return { stream, bytes: size }
}
