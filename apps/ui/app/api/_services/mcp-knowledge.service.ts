import 'server-only'

import { brainPageTypeSchema, brainSlugSchema, type BrainPageSummary, type Memory } from '@rerun/contracts'

import { assertSpaceAccess, visibleSpaceIds, type Actor } from '@/app/api/_auth/access'
import { brainAuthorOf } from '@/app/api/_auth/signature'
import { agentFilesBase, deleteBrainPage, deleteMemory, EngineRequestError, listBrainPages, listFiles, listMemories, readBrainPage, recallMemories, setBrainPageMeta, SHARED_FILES_BASE, writeBrainPage } from '@/lib/engine/client'
import type { EngineConnection } from '@/lib/engine/types'
import { readTextFilePage } from '@/lib/files/text-page'
import { asNumber, asString, asStringArray, clamp, requireConfirmation, requireString } from '@/lib/mcp/args'
import { MAX_BRAIN_PAGE_CHARS, MAX_MEMORIES_LISTED, MAX_MEMORIES_RECALLED } from '@/lib/mcp/knowledge-tools'
import { memberBehindKey, memberEmailOf } from '@/lib/mcp/member'
import { isTextSkillFile } from '@/lib/skills/folder-import'
import { resolveAgentTarget } from './chat.service'
import { dispatchConversationTool } from './mcp-conversations.service'
import { getWorkspaceConnection, NoEngineError } from './workspace-engine.service'

const NO_MACHINE = 'This workspace has no machine yet: it gets one with its first coworker. Create one with create_agent first.'

async function workspaceMachine(workspaceId: number): Promise<EngineConnection> {
    try {
        return await getWorkspaceConnection(workspaceId)
    } catch (err) {
        if (err instanceof NoEngineError) throw new Error(NO_MACHINE)
        throw err
    }
}

// A box from before the Brain answers 404 on every /brain route.
function brainError(err: unknown, slug?: string): Error {
    if (err instanceof EngineRequestError && err.status === 404) return new Error(slug ? `No page "${slug}" in the Brain. list_brain_pages gives the slugs.` : 'The machine of this workspace must be updated before it keeps a Brain.')
    if (err instanceof EngineRequestError && err.status === 409) return new Error(`Page "${slug}" changed since you read it, or already exists. Read it again with get_brain_page and redo your change on what it says now, passing its new hash as baseHash.`)
    return err instanceof Error ? err : new Error('The Brain could not be reached.')
}

function memoryView(memory: Memory) {
    return { id: memory.id, kind: memory.kind, tags: memory.tags, content: memory.content, createdAt: memory.createdAt, ...(memory.status ? { status: memory.status } : {}) }
}

async function listAgentMemories(actor: Actor, args: Record<string, unknown>) {
    const { conn, engineAgentId } = await resolveAgentTarget(requireString(args.agentId, 'agentId'), 'use', actor)
    const kind = asString(args.kind)
    const tag = asString(args.tag)
    const limit = clamp(asNumber(args.limit), 50, MAX_MEMORIES_LISTED)
    const offset = Math.max(0, Math.trunc(asNumber(args.offset) ?? 0))

    // The engine hands back every memory of the coworker at once: filtered and paged here.
    const matching = (await listMemories(conn, engineAgentId))
        .filter(memory => (!kind || memory.kind === kind) && (!tag || memory.tags.includes(tag)))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const page = matching.slice(offset, offset + limit)
    const next = offset + page.length
    return { memories: page.map(memoryView), total: matching.length, nextOffset: next < matching.length ? next : null }
}

async function recallAgentMemories(actor: Actor, args: Record<string, unknown>) {
    const { conn, engineAgentId } = await resolveAgentTarget(requireString(args.agentId, 'agentId'), 'use', actor)
    const memories = await recallMemories(conn, engineAgentId, { query: requireString(args.query, 'query'), limit: clamp(asNumber(args.limit), 5, MAX_MEMORIES_RECALLED) })
    return { memories: memories.map(memoryView) }
}

async function deleteAgentMemory(actor: Actor, args: Record<string, unknown>) {
    requireConfirmation(args, 'the memory')
    const { conn, engineAgentId } = await resolveAgentTarget(requireString(args.agentId, 'agentId'), 'manage', actor)
    const memoryId = requireString(args.memoryId, 'memoryId')
    try {
        await deleteMemory(conn, engineAgentId, memoryId)
    } catch (err) {
        if (err instanceof EngineRequestError && err.status === 404) throw new Error(`No memory "${memoryId}" on this coworker. list_memories gives the ids.`)
        throw err
    }
    return { memoryId, deleted: true }
}

// A coworker folder is read by whoever may use the coworker, as in its Files tab; the shared folder
// by any member, as in the Files of the Brain.
async function fileLocation(actor: Actor, args: Record<string, unknown>): Promise<{ conn: EngineConnection; base: string; where: string }> {
    const agentId = asString(args.agentId)
    if (agentId && args.shared === true) throw new Error('Pass agentId for a coworker folder or shared: true for the shared folder, not both.')
    if (agentId) {
        const { conn, engineAgentId } = await resolveAgentTarget(agentId, 'use', actor)
        return { conn, base: agentFilesBase(engineAgentId), where: 'this coworker folder' }
    }
    if (args.shared !== true) throw new Error('Pass agentId to read a coworker folder, or shared: true for the folder the whole workspace shares.')
    return { conn: await workspaceMachine(actor.workspaceId), base: SHARED_FILES_BASE, where: 'the shared folder' }
}

const relativePath = (value: unknown) => (asString(value) ?? '').replace(/^\/+/, '').replace(/\/+$/, '')

async function listFolder(actor: Actor, args: Record<string, unknown>) {
    const { conn, base } = await fileLocation(actor, args)
    const path = relativePath(args.path)
    const entries = await listFiles(conn, base, path || '.')
    return { path, entries: entries.filter(entry => !entry.name.startsWith('.')).map(entry => ({ name: entry.name, path: path ? `${path}/${entry.name}` : entry.name, type: entry.type, bytes: entry.size })) }
}

async function readFolderFile(actor: Actor, args: Record<string, unknown>) {
    const path = relativePath(requireString(args.path, 'path'))
    if (!isTextSkillFile(path)) throw new Error(`"${path}" is not a text file, so there is nothing to read here. Open it in the Rerun app.`)
    const { conn, base, where } = await fileLocation(actor, args)
    const offset = asNumber(args.offset) ?? 0
    try {
        return { path, ...(await readTextFilePage(conn, base, path, offset)) }
    } catch (err) {
        if (err instanceof EngineRequestError && (err.status === 404 || err.status === 500)) throw new Error(`No file "${path}" in ${where}. list_files shows what it holds.`)
        throw err
    }
}

// A Box the caller cannot open stays out of what they read, and its pages read as filed for
// everyone, the way the Brain shows them in the app.
async function listPages(actor: Actor, args: Record<string, unknown>) {
    const conn = await workspaceMachine(actor.workspaceId)
    const type = asString(args.type)
    const spaceId = asString(args.spaceId)
    const [pages, visible] = await Promise.all([listBrainPages(conn).catch(err => Promise.reject(brainError(err))), visibleSpaceIds(actor)])
    const filedUnder = (page: BrainPageSummary) => (page.spaceId && (visible === 'all' || visible.has(page.spaceId)) ? page.spaceId : null)
    return {
        pages: pages
            .map(page => ({ ...page, spaceId: filedUnder(page) }))
            .filter(page => (!type || page.type === type) && (!spaceId || page.spaceId === spaceId))
            .map(({ slug, title, type, tags, spaceId, updatedAt, updatedBy, hash }) => ({ slug, title, type, tags, spaceId, updatedAt, updatedBy, hash })),
    }
}

async function getPage(actor: Actor, args: Record<string, unknown>) {
    const slug = requireString(args.slug, 'slug')
    const conn = await workspaceMachine(actor.workspaceId)
    try {
        const { page, revisions } = await readBrainPage(conn, slug)
        return { ...page, revisions }
    } catch (err) {
        throw brainError(err, slug)
    }
}

function readPageWrite(args: Record<string, unknown>) {
    const slug = brainSlugSchema.safeParse(args.slug)
    if (!slug.success) throw new Error('slug must be lowercase kebab-case, 64 characters at most, e.g. "pricing" or "acme-corp".')
    const type = brainPageTypeSchema.safeParse(args.type)
    if (!type.success) throw new Error(`Unknown page type "${String(args.type)}". Expected one of: ${brainPageTypeSchema.options.join(', ')}`)
    const content = typeof args.content === 'string' ? args.content : ''
    if (content.length > MAX_BRAIN_PAGE_CHARS) throw new Error(`The content is ${content.length} characters, over the ${MAX_BRAIN_PAGE_CHARS} a page holds. Split it into several pages.`)
    if (args.baseHash !== null && typeof args.baseHash !== 'string') throw new Error('baseHash is null to create a page, or the hash get_brain_page gave to change one.')
    return { slug: slug.data, title: requireString(args.title, 'title'), type: type.data, content, sources: asStringArray(args.sources), baseHash: args.baseHash }
}

async function writePage(actor: Actor, args: Record<string, unknown>) {
    const member = memberBehindKey(actor)
    const { slug, ...page } = readPageWrite(args)
    const spaceId = asString(args.spaceId)
    if (spaceId) await assertSpaceAccess(spaceId, 'use', actor)
    const conn = await workspaceMachine(actor.workspaceId)
    const author = await brainAuthorOf({ userId: member.userId, organizationStaff: member.organizationStaff, workspace: { id: member.workspaceId }, email: await memberEmailOf(member) })

    const written = await writeBrainPage(conn, slug, { ...page, author }).catch(err => Promise.reject(brainError(err, slug)))
    const answer = (detail: typeof written) => ({ slug, hash: detail.page.hash, title: detail.page.title, spaceId: detail.page.spaceId, created: page.baseHash === null })
    if (!spaceId) return answer(written)

    // The engine's write takes no Box, so filing is a second call: one that fails leaves the page
    // written, for everyone, the way the Brain of the app does.
    try {
        return answer(await setBrainPageMeta(conn, slug, { spaceId }))
    } catch {
        return { ...answer(written), note: `The page is written, but it could not be filed under the Box, so it reads as everyone's. To file it, call write_brain_page again with baseHash "${written.page.hash}" and spaceId.` }
    }
}

async function deletePage(actor: Actor, args: Record<string, unknown>) {
    requireConfirmation(args, 'the page of the Brain')
    const slug = requireString(args.slug, 'slug')
    const conn = await workspaceMachine(actor.workspaceId)
    try {
        await deleteBrainPage(conn, slug)
    } catch (err) {
        throw brainError(err, slug)
    }
    return { slug, deleted: true }
}

// Chained after the account tools: the conversations come next, then the published pages, the
// template library and the Vault.
export async function dispatchKnowledgeTool(actor: Actor, name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
        case 'list_memories':
            return listAgentMemories(actor, args)
        case 'recall_memories':
            return recallAgentMemories(actor, args)
        case 'delete_memory':
            return deleteAgentMemory(actor, args)
        case 'list_files':
            return listFolder(actor, args)
        case 'read_file':
            return readFolderFile(actor, args)
        case 'list_brain_pages':
            return listPages(actor, args)
        case 'get_brain_page':
            return getPage(actor, args)
        case 'write_brain_page':
            return writePage(actor, args)
        case 'delete_brain_page':
            return deletePage(actor, args)
        default:
            return await dispatchConversationTool(actor, name, args)
    }
}
