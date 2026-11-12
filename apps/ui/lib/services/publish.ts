import { keepVisible } from '@/app/api/_auth/access'
import { getSpaceConnection } from '@/app/api/_services/space.service'
import type { Database } from '@/app/api/database.types'
import { fetchRawFile, listFiles } from '@/lib/engine/client'
import { siteContentType, withUtf8Charset } from '@/lib/files/content-type'
import type { EngineConnection } from '@/lib/engine/types'
import { isOpaqueToken, opaqueToken } from '@/lib/opaque-token'
import {
    coworkerAccessMessage,
    effectivePolicy,
    humanMayGrant,
    isPublishedAccess,
    normalizeInvites,
    resolveCoworkerAccess,
    type AccessResolution,
    type EffectivePolicy,
    type PublishedAccess,
} from '@/lib/published/access'
import { PUBLISHED_SLUG_TOKEN_LENGTH, publishedRawFileUrl, publishedSiteOrigin, rendersAsPage, slugPrefix, suffixedSlug } from '@/lib/published/host'
import { hashPassword } from '@/lib/published/password'
import { siteObjectKey } from '@/lib/published/site-path'
import { htmlTitle } from '@/lib/published/title'
import { hubBaseUrl } from '@/lib/services/hub'
import type { PublishResult, PublishedFile } from '@/lib/services/types'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMany, selectMaybeSingle, selectSingle } from '@/supabase/supabase-helpers'

// File publishing. An agent publishes a file from its engine workspace; the bytes are copied
// server-to-server (engine /raw → Supabase Storage), NEVER through the LLM context. A
// `published_files` row records the mapping, the identity (slug) and who may open it. Everything
// is served from <slug>.rerun.site (lib/published/host.ts), which checks that access before any
// byte leaves the private bucket; /p/<slug> is the older link and redirects there.

export const PUBLISHED_BUCKET = 'published'
const MAX_PUBLISH_BYTES = 25 * 1024 * 1024 // 25 MB — keep well under Storage's per-object limit.
const MAX_SITE_FILES = 300
const MAX_SITE_DEPTH = 8
const MAX_SITE_BYTES = 50 * 1024 * 1024
const SITE_UPLOAD_CONCURRENCY = 8
const SITE_ENTRY = 'index.html'
const THUMBNAIL_URL_TTL_SECONDS = 60 * 60

type ServiceClient = ReturnType<typeof createServiceRoleClient>
type PublishedRow = Database['public']['Tables']['published_files']['Row']
type PublishedUpdate = Database['public']['Tables']['published_files']['Update']

type AgentContext = {
    engineAgentId: string
    spaceId: string
    workspaceId: number
    conn: EngineConnection
}

// Resolve the calling agent (trusted: agentId comes from the Hub-authenticated x-rerun-agent
// header) to its engine connection + the workspace/space ids used for keying and isolation.
// Dedicated resolver on purpose: getAgentChatTarget doesn't expose workspace_id/space_id.
async function resolveAgent(agentId: string): Promise<AgentContext> {
    const supabase = createServiceRoleClient()
    const { data: agent } = await selectSingle(supabase, 'agents', ['engine_agent_id', 'space_id', 'workspace_id'] as const, { id: agentId })
    if (!agent?.engine_agent_id) throw new Error('Coworker not configured or not found')
    const conn = await getSpaceConnection(agent.space_id)
    return { engineAgentId: agent.engine_agent_id, spaceId: agent.space_id, workspaceId: agent.workspace_id, conn }
}

export async function workspacePublishPolicy(workspaceId: number): Promise<EffectivePolicy> {
    const { data } = await selectMaybeSingle(createServiceRoleClient(), 'workspaces', ['publish_policy'] as const, { id: workspaceId })
    return effectivePolicy(data?.publish_policy)
}

// The bucket was public before links had an access: a raw Storage URL kept working for whoever
// held it. Turned private here rather than in a migration, so it only happens once this code,
// which never hands out a public Storage URL, is the one running.
async function ensureBucket(supabase: ServiceClient): Promise<void> {
    const { error } = await supabase.storage.createBucket(PUBLISHED_BUCKET, { public: false })
    if (error) await supabase.storage.updateBucket(PUBLISHED_BUCKET, { public: false }).catch(() => {})
}

function fileNameOf(path: string): string {
    return path.split(/[\\/]/).pop() || 'file'
}

type PublishedKind = 'file' | 'site'
type PublishedObjects = { kind: string; storage_key: string; files: string[] | null; thumbnail_key?: string | null }

// Key bytes by workspace + slug + original filename, so re-publishing a different file under a
// new slug never collides, and the browser sees a sensible filename.
function storageKeyFor(workspaceId: number, slug: string, path: string): string {
    return `${workspaceId}/${slug}/${fileNameOf(path)}`
}

export function thumbnailKeyFor(workspaceId: number, slug: string, version: number): string {
    return `${workspaceId}/${slug}/thumb-${version}.png`
}

export function shareUrlFor(slug: string): string {
    return publishedSiteOrigin(slug) ?? `${hubBaseUrl()}/p/${slug}`
}

// What a service that downloads the file itself fetches (Instagram taking an image by URL). Without a
// publish host, /p/<slug> already leads to the bytes.
function fileUrlFor(slug: string, kind: string, contentType: string): string | null {
    return rendersAsPage(kind, contentType) ? null : (publishedRawFileUrl(slug) ?? shareUrlFor(slug))
}

function storageKeysOf(row: PublishedObjects): string[] {
    const keys = row.kind !== 'site' ? [row.storage_key] : (row.files ?? []).map((_, index) => siteObjectKey(row.storage_key, index))
    return row.thumbnail_key ? [...keys, row.thumbnail_key] : keys
}

async function generateFreeSlug(supabase: ServiceClient, customSlug?: string): Promise<string> {
    for (let i = 0; i < 5; i++) {
        const token = opaqueToken(PUBLISHED_SLUG_TOKEN_LENGTH)
        const slug = customSlug ? suffixedSlug(customSlug, token) : token
        const { data } = await selectMaybeSingle(supabase, 'published_files', ['slug'] as const, { slug })
        if (!data) return slug
    }
    throw new Error('Could not generate a unique slug, please try again')
}

// The coworker may pass back the name it chose or the full slug it was given: either way, a
// republish keeps its URL. Links published before the suffix existed keep theirs too. A full slug
// given for a path with no row left (unpublished, or another file) is re-suffixed once, never twice.
function isSameCustomSlug(existingSlug: string, customSlug: string): boolean {
    if (existingSlug === customSlug.trim().toLowerCase()) return true
    const prefix = slugPrefix(customSlug)
    return existingSlug.startsWith(`${prefix}-`) && isOpaqueToken(existingSlug.slice(prefix.length + 1), PUBLISHED_SLUG_TOKEN_LENGTH)
}

function joinPath(dir: string, name: string): string {
    return dir === '.' || dir === '' ? name : `${dir}/${name}`
}

async function isDirectory(conn: EngineConnection, base: string, path: string): Promise<boolean> {
    if (path === '.') return true
    const slash = path.lastIndexOf('/')
    const parent = slash === -1 ? '.' : path.slice(0, slash)
    const entries = await listFiles(conn, base, parent)
    return entries.some(entry => entry.name === path.slice(slash + 1) && entry.type === 'dir')
}

// Every file of a folder about to be published, as paths relative to it. Dotfiles, .git and
// node_modules are a project's plumbing, never part of what a visitor should be able to fetch.
async function listSiteFiles(conn: EngineConnection, base: string, root: string): Promise<string[]> {
    const files: string[] = []
    let totalBytes = 0
    const walk = async (rel: string, depth: number): Promise<void> => {
        if (depth > MAX_SITE_DEPTH) throw new Error(`Folder is nested too deep to publish (max ${MAX_SITE_DEPTH} levels).`)
        for (const entry of await listFiles(conn, base, joinPath(root, rel))) {
            if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
            const entryRel = joinPath(rel, entry.name)
            if (entry.type === 'dir') {
                await walk(entryRel, depth + 1)
                continue
            }
            if (entry.size > MAX_PUBLISH_BYTES) throw new Error(`File too large to publish: ${entryRel} (max ${MAX_PUBLISH_BYTES / 1024 / 1024} MB per file).`)
            totalBytes += entry.size
            files.push(entryRel)
            if (files.length > MAX_SITE_FILES) throw new Error(`Folder has too many files to publish (max ${MAX_SITE_FILES}).`)
            if (totalBytes > MAX_SITE_BYTES) throw new Error(`Folder too large to publish (max ${MAX_SITE_BYTES / 1024 / 1024} MB in total).`)
        }
    }
    await walk('', 0)
    if (!files.includes(SITE_ENTRY)) throw new Error(`A published folder needs an ${SITE_ENTRY} at its root: ${root}`)
    return files
}

async function readWorkspaceFile(conn: EngineConnection, base: string, path: string): Promise<Response> {
    const res = await fetchRawFile(conn, base, path)
    if (res.status === 404) throw new Error(`File not found in workspace: ${path}`)
    if (!res.ok) throw new Error(`Failed to read file from engine: ${res.status}`)
    return res
}

async function uploadObject(supabase: ServiceClient, key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const { error } = await supabase.storage.from(PUBLISHED_BUCKET).upload(key, bytes, { contentType, upsert: true })
    if (error) throw new Error(`Storage upload failed: ${error.message}`)
}

type UploadedObjects = { kind: PublishedKind; storageKey: string; files: string[] | null; contentType: string; size: number; title: string }

function decodedTitle(bytes: Uint8Array, contentType: string, fallback: string): string {
    if (!contentType.startsWith('text/html')) return fallback
    return htmlTitle(new TextDecoder().decode(bytes.subarray(0, 64 * 1024))) ?? fallback
}

async function uploadFile(supabase: ServiceClient, conn: EngineConnection, base: string, path: string, storageKey: string): Promise<UploadedObjects> {
    const res = await readWorkspaceFile(conn, base, path)
    const contentType = withUtf8Charset(res.headers.get('Content-Type') ?? 'application/octet-stream')
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.byteLength === 0) throw new Error(`File is empty: ${path}`)
    if (bytes.byteLength > MAX_PUBLISH_BYTES) {
        throw new Error(`File too large to publish (${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB; max ${MAX_PUBLISH_BYTES / 1024 / 1024} MB).`)
    }
    await uploadObject(supabase, storageKey, bytes, contentType)
    const title = decodedTitle(bytes, contentType, fileNameOf(path))
    return { kind: 'file', storageKey, files: null, contentType, size: bytes.byteLength, title }
}

// A folder goes under a fresh prefix on every publish, and each file under its index in the
// manifest rather than its own name: the row only switches to the new prefix once every upload
// landed, so a republish never serves half a site, and no file name can trip Storage's key rules.
async function uploadSite(supabase: ServiceClient, conn: EngineConnection, base: string, root: string, prefix: string): Promise<UploadedObjects> {
    const files = await listSiteFiles(conn, base, root)
    const entryIndex = files.indexOf(SITE_ENTRY)
    let title = fileNameOf(root)
    let size = 0
    let next = 0
    const worker = async (): Promise<void> => {
        while (next < files.length) {
            const index = next++
            const res = await readWorkspaceFile(conn, base, joinPath(root, files[index]))
            const bytes = new Uint8Array(await res.arrayBuffer())
            size += bytes.byteLength
            if (index === entryIndex) title = decodedTitle(bytes, siteContentType(SITE_ENTRY), title)
            await uploadObject(supabase, siteObjectKey(prefix, index), bytes, siteContentType(files[index]))
        }
    }
    try {
        await Promise.all(Array.from({ length: Math.min(SITE_UPLOAD_CONCURRENCY, files.length) }, worker))
    } catch (err) {
        await supabase.storage.from(PUBLISHED_BUCKET).remove(files.map((_, index) => siteObjectKey(prefix, index))).catch(() => {})
        throw err
    }
    return { kind: 'site', storageKey: prefix, files, contentType: siteContentType(SITE_ENTRY), size, title }
}

const ACCESS_COLUMNS = ['access', 'requested_access', 'invited', 'password_hash', 'access_version'] as const
type AccessRow = Pick<PublishedRow, (typeof ACCESS_COLUMNS)[number]>
type AccessFields = Pick<PublishedUpdate, 'access' | 'requested_access' | 'invited' | 'password_hash' | 'access_version'>

export type AccessInput = { invite?: readonly string[]; password?: string }

function sameEntries(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every(entry => b.includes(entry))
}

function currentAccess(row: AccessRow | null | undefined): AccessResolution | undefined {
    if (!row || !isPublishedAccess(row.access)) return undefined
    return { access: row.access, requestedAccess: row.requested_access === 'public' ? 'public' : null }
}

// The columns a change of access writes. The version moves whenever someone who could open the link
// before might no longer: another mode, another password, another list of invites.
async function accessFields(next: AccessResolution, input: AccessInput, existing?: AccessRow | null): Promise<AccessFields> {
    const invited = input.invite ? normalizeInvites(input.invite) : (existing?.invited ?? [])
    const passwordHash = input.password ? await hashPassword(input.password) : (existing?.password_hash ?? null)
    if (next.access === 'invited' && invited.length === 0) throw new Error('Name at least one email or @domain to invite.')
    if (next.access === 'password' && !passwordHash) throw new Error('Give a password for a password-protected link.')

    const changed = !existing || existing.access !== next.access || !!input.password || !sameEntries(invited, existing.invited)
    const version = existing ? existing.access_version + (changed ? 1 : 0) : 1
    return { access: next.access, requested_access: next.requestedAccess, invited, password_hash: passwordHash, access_version: version }
}

export type PublishOptions = AccessInput & { access?: PublishedAccess }

// Publish a workspace file, or a folder with an index.html served as a site. Re-publishing the same
// path upserts in place and keeps the existing slug/URL (unless a new slug is given), and the access
// it had unless a new one is asked for.
export async function publishFile(agentId: string, path: string, customSlug?: string, options: PublishOptions = {}): Promise<PublishResult> {
    const cleanPath = path.trim().replace(/(.)\/+$/, '$1')
    if (!cleanPath) throw new Error('Missing required argument: path')

    const { engineAgentId, spaceId, workspaceId, conn } = await resolveAgent(agentId)
    const supabase = createServiceRoleClient()
    const base = `/agents/${engineAgentId}/files`

    // Already published by this agent under this path? → republish in place (stable URL).
    const { data: existing } = await selectMaybeSingle(
        supabase,
        'published_files',
        ['slug', 'kind', 'storage_key', 'files', 'thumbnail_key', ...ACCESS_COLUMNS] as const,
        { agent_id: agentId, source_path: cleanPath },
    )

    const policy = await workspacePublishPolicy(workspaceId)
    const resolution = resolveCoworkerAccess({ policy, requested: options.access, current: currentAccess(existing) })
    const access = await accessFields(resolution, options, existing)

    const keepsExistingSlug = existing && (!customSlug || isSameCustomSlug(existing.slug, customSlug))
    const slug = keepsExistingSlug ? existing.slug : await generateFreeSlug(supabase, customSlug)
    const url = shareUrlFor(slug)

    // The bytes go engine → Storage server-to-server, never through the LLM context.
    await ensureBucket(supabase)
    const uploaded = (await isDirectory(conn, base, cleanPath))
        ? await uploadSite(supabase, conn, base, cleanPath, `${workspaceId}/${slug}/site-${Date.now()}`)
        : await uploadFile(supabase, conn, base, cleanPath, storageKeyFor(workspaceId, slug, cleanPath))

    const row: Database['public']['Tables']['published_files']['Insert'] = {
        workspace_id: workspaceId,
        space_id: spaceId,
        agent_id: agentId,
        source_path: cleanPath,
        storage_key: uploaded.storageKey,
        kind: uploaded.kind,
        files: uploaded.files,
        content_type: uploaded.contentType,
        size: uploaded.size,
        public_url: url,
        slug,
        title: uploaded.title,
        thumbnail_key: null,
        updated_at: new Date().toISOString(),
        ...access,
    }
    const { error: rowErr } = await supabase
        .from('published_files')
        .upsert<Database['public']['Tables']['published_files']['Insert']>(row, { onConflict: 'agent_id,source_path' })
    if (rowErr) throw new Error(`Failed to record published file: ${rowErr.message}`)

    // Whatever the previous publish left behind and this one no longer points at, the old
    // thumbnail included: it showed the previous bytes.
    if (existing) {
        const current = new Set(storageKeysOf({ kind: uploaded.kind, storage_key: uploaded.storageKey, files: uploaded.files }))
        const stale = storageKeysOf(existing).filter(key => !current.has(key))
        if (stale.length > 0) await supabase.storage.from(PUBLISHED_BUCKET).remove(stale).catch(() => {})
    }

    return {
        status: 'published',
        url,
        fileUrl: fileUrlFor(slug, uploaded.kind, uploaded.contentType),
        slug,
        path: cleanPath,
        kind: uploaded.kind,
        contentType: uploaded.contentType,
        size: uploaded.size,
        title: uploaded.title,
        access: resolution.access,
        requestedAccess: resolution.requestedAccess,
        message: coworkerAccessMessage(options.access, resolution, access.invited ?? []),
    }
}

async function removePublished(supabase: ServiceClient, row: PublishedObjects & { id: string }): Promise<void> {
    await supabase.storage.from(PUBLISHED_BUCKET).remove(storageKeysOf(row)).catch(() => {})
    const { error } = await supabase.from('published_files').delete().eq('id', row.id)
    if (error) throw new Error(`Failed to unpublish: ${error.message}`)
}

const REMOVAL_COLUMNS = ['id', 'slug', 'source_path', 'kind', 'storage_key', 'files', 'thumbnail_key'] as const

// Remove a published file: delete the Storage objects first (tolerate already-gone), then the
// row — so the link stops working immediately afterwards. Scoped to the agent: an agent can
// only unpublish its own files.
export async function unpublishFile(agentId: string, ident: { path?: string; slug?: string }): Promise<{ status: 'unpublished'; slug: string; path: string }> {
    const path = ident.path?.trim()
    const slug = ident.slug?.trim()
    if (!path && !slug) throw new Error('Provide either path or slug to unpublish')

    const supabase = createServiceRoleClient()
    const filters = slug ? { agent_id: agentId, slug } : { agent_id: agentId, source_path: path as string }
    const { data: rowData } = await selectMaybeSingle(supabase, 'published_files', REMOVAL_COLUMNS, filters)
    if (!rowData) throw new Error(slug ? `No published file with slug: ${slug}` : `No published file for path: ${path}`)

    await removePublished(supabase, rowData)
    return { status: 'unpublished', slug: rowData.slug, path: rowData.source_path }
}

// A person may take down any link of their workspace, whichever coworker published it.
export async function unpublishInWorkspace(workspaceId: number, slug: string): Promise<void> {
    const supabase = createServiceRoleClient()
    const { data: rowData } = await selectMaybeSingle(supabase, 'published_files', REMOVAL_COLUMNS, { workspace_id: workspaceId, slug })
    if (!rowData) throw new Error('This link no longer exists')
    await removePublished(supabase, rowData)
}

export type AccessChange = AccessInput & { access: PublishedAccess }

// What a person sets from the share dialog. It answers a coworker's pending ask as well: whatever
// they pick, the ask is settled.
export async function updatePublishedAccess(workspaceId: number, slug: string, change: AccessChange): Promise<PublishedFile> {
    const supabase = createServiceRoleClient()
    const { data: row } = await selectMaybeSingle(supabase, 'published_files', ['id', ...ACCESS_COLUMNS] as const, { workspace_id: workspaceId, slug })
    if (!row) throw new Error('This link no longer exists')

    const policy = await workspacePublishPolicy(workspaceId)
    if (!humanMayGrant(policy, change.access)) throw new Error('Public links are turned off for this workspace.')

    const fields = await accessFields({ access: change.access, requestedAccess: null }, change, row)
    const { error } = await supabase.from('published_files').update<PublishedUpdate>(fields).eq('id', row.id)
    if (error) throw new Error(`Failed to update the link: ${error.message}`)

    const updated = await getPublishedInWorkspace(workspaceId, slug)
    if (!updated) throw new Error('This link no longer exists')
    return updated
}

// "Keep private" in the chat: the link stays as it is and the ask goes away.
export async function dismissAccessRequest(workspaceId: number, slug: string): Promise<void> {
    const { error } = await createServiceRoleClient()
        .from('published_files')
        .update<PublishedUpdate>({ requested_access: null })
        .eq('workspace_id', workspaceId)
        .eq('slug', slug)
    if (error) throw new Error(`Failed to update the link: ${error.message}`)
}

// Turning public links off for the workspace closes the ones already open: they go back to the
// members, and every cookie a visitor held stops working.
export async function closePublicLinks(workspaceId: number): Promise<number> {
    const supabase = createServiceRoleClient()
    const { data: rows } = await selectMany(supabase, 'published_files', ['id', 'access_version'] as const, { workspace_id: workspaceId, access: 'public' })
    for (const row of rows ?? []) {
        await supabase
            .from('published_files')
            .update<PublishedUpdate>({ access: 'workspace', requested_access: null, access_version: row.access_version + 1 })
            .eq('id', row.id)
    }
    await supabase.from('published_files').update<PublishedUpdate>({ requested_access: null }).eq('workspace_id', workspaceId).not('requested_access', 'is', null)
    return rows?.length ?? 0
}

export async function countPublicLinks(workspaceId: number): Promise<number> {
    const { data } = await selectMany(createServiceRoleClient(), 'published_files', ['id'] as const, { workspace_id: workspaceId, access: 'public' })
    return data?.length ?? 0
}

const LISTED_COLUMNS = [
    'slug',
    'agent_id',
    'source_path',
    'kind',
    'content_type',
    'size',
    'title',
    'access',
    'requested_access',
    'invited',
    'password_hash',
    'thumbnail_key',
    'created_at',
    'updated_at',
] as const

type ListedRow = Pick<PublishedRow, (typeof LISTED_COLUMNS)[number]>

async function thumbnailUrls(supabase: ServiceClient, rows: readonly ListedRow[]): Promise<Map<string, string>> {
    const keys = rows.map(row => row.thumbnail_key).filter((key): key is string => !!key)
    if (keys.length === 0) return new Map()
    const { data } = await supabase.storage.from(PUBLISHED_BUCKET).createSignedUrls(keys, THUMBNAIL_URL_TTL_SECONDS)
    return new Map((data ?? []).flatMap(entry => (entry.path && entry.signedUrl ? [[entry.path, entry.signedUrl] as const] : [])))
}

async function toPublishedFiles(supabase: ServiceClient, rows: readonly ListedRow[]): Promise<PublishedFile[]> {
    const thumbnails = await thumbnailUrls(supabase, rows)
    return rows.map(r => ({
        slug: r.slug,
        agentId: r.agent_id,
        path: r.source_path,
        url: shareUrlFor(r.slug),
        fileUrl: fileUrlFor(r.slug, r.kind, r.content_type),
        kind: r.kind === 'site' ? 'site' : 'file',
        contentType: r.content_type,
        size: r.size,
        title: r.title ?? fileNameOf(r.source_path),
        access: isPublishedAccess(r.access) ? r.access : 'workspace',
        requestedAccess: r.requested_access === 'public' ? 'public' : null,
        invited: r.invited,
        hasPassword: !!r.password_hash,
        thumbnailUrl: (r.thumbnail_key && thumbnails.get(r.thumbnail_key)) || null,
        publishedAt: r.created_at,
        updatedAt: r.updated_at,
    }))
}

// List the files this agent currently has published.
export async function listPublished(agentId: string): Promise<{ files: PublishedFile[] }> {
    const supabase = createServiceRoleClient()
    const { data } = await selectMany(supabase, 'published_files', LISTED_COLUMNS, { agent_id: agentId }, { column: 'updated_at', ascending: false })
    return { files: await toPublishedFiles(supabase, data ?? []) }
}

// `visibleAgents` narrows the list to the coworkers the caller reaches, before any thumbnail is signed.
export async function listWorkspacePublished(workspaceId: number, visibleAgents: 'all' | Set<string> = 'all'): Promise<PublishedFile[]> {
    const supabase = createServiceRoleClient()
    const { data } = await selectMany(supabase, 'published_files', LISTED_COLUMNS, { workspace_id: workspaceId }, { column: 'updated_at', ascending: false })
    return toPublishedFiles(supabase, keepVisible(data ?? [], visibleAgents, row => row.agent_id))
}

export async function getPublishedInWorkspace(workspaceId: number, slug: string): Promise<PublishedFile | null> {
    const supabase = createServiceRoleClient()
    const { data } = await selectMaybeSingle(supabase, 'published_files', LISTED_COLUMNS, { workspace_id: workspaceId, slug })
    if (!data) return null
    const [file] = await toPublishedFiles(supabase, [data])
    return file
}
