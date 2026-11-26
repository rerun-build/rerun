import 'server-only'

import { EMAIL_DELIVERY } from '@rerun/cloud/email'

import { assertAgentInWorkspace, visibleAgentIds, type Actor } from '@/app/api/_auth/access'
import { AppError } from '@/lib/i18n/action-error'
import { asString, asStringArray, requireConfirmation, requireString } from '@/lib/mcp/args'
import { isPublishedAccess } from '@/lib/published/access'
import { parseDataGrants, type DataGrant } from '@/lib/published/data-grants'
import { assertPublishedLinkInReach, getPublishedInWorkspace, listWorkspacePublished, unpublishInWorkspace, updatePublishedAccess, type AccessChange } from '@/lib/services/publish'
import { publishWithThumbnail } from '@/lib/services/publish-thumbnail'
import { getPageData, updatePageData } from '@/lib/services/published-data'
import type { PublishedFile } from '@/lib/services/types'
import { dispatchLibraryTool } from './mcp-library.service'

function linkView(file: PublishedFile) {
    return {
        slug: file.slug,
        agentId: file.agentId,
        path: file.path,
        url: file.url,
        ...(file.fileUrl ? { fileUrl: file.fileUrl } : {}),
        kind: file.kind,
        title: file.title,
        access: file.access,
        requestedAccess: file.requestedAccess,
        ...(file.access === 'invited' ? { invited: file.invited } : {}),
        ...(file.access === 'password' ? { hasPassword: file.hasPassword } : {}),
        publishedAt: file.publishedAt,
        updatedAt: file.updatedAt,
    }
}

async function listLinks(actor: Actor, args: Record<string, unknown>) {
    const agentId = asString(args.agentId)
    const files = await listWorkspacePublished(actor.workspaceId, await visibleAgentIds(actor))
    return { links: files.filter(file => !agentId || file.agentId === agentId).map(linkView) }
}

// As Publish in the Files tab: whoever may use the coworker, with the access the workspace gives a
// new link.
async function publish(actor: Actor, args: Record<string, unknown>) {
    const agent = await assertAgentInWorkspace(requireString(args.agentId, 'agentId'), 'use', actor)
    const result = await publishWithThumbnail(agent.id, requireString(args.path, 'path'))
    return { slug: result.slug, url: result.url, ...(result.fileUrl ? { fileUrl: result.fileUrl } : {}), kind: result.kind, title: result.title, access: result.access, message: result.message }
}

async function reachableLink(actor: Actor, slug: string): Promise<PublishedFile> {
    await assertPublishedLinkInReach(actor, slug)
    const file = await getPublishedInWorkspace(actor.workspaceId, slug)
    if (!file) throw new AppError('publishedLinkGone')
    return file
}

function accessChangeOf(args: Record<string, unknown>): AccessChange | null {
    if (args.access === undefined) return null
    if (!isPublishedAccess(args.access)) throw new AppError('unknownAccess')
    if (args.access === 'invited' && !EMAIL_DELIVERY) throw new AppError('noEmailForInvites')
    const invite = asStringArray(args.invite)
    const password = asString(args.password)
    return { access: args.access, ...(invite.length > 0 ? { invite } : {}), ...(password ? { password } : {}) }
}

function grantsOf(args: Record<string, unknown>): DataGrant[] | null {
    if (args.tables === undefined) return null
    if (!Array.isArray(args.tables)) throw new Error('tables is a list like [{"database": "shared", "table": "leads", "grant": "read"}], or [] to take them all away.')
    return parseDataGrants(args.tables)
}

// The way the share dialog changes a link: a person, so a public link goes live at once unless the
// workspace turned them off, and only the tables they reach can be raised. Everything is checked
// before anything is written, and the tables, which need the machine to answer, are written first:
// a machine that does not answer leaves the link as it was.
async function updateLink(actor: Actor, args: Record<string, unknown>) {
    const slug = requireString(args.slug, 'slug')
    const access = accessChangeOf(args)
    const grants = grantsOf(args)
    let file = await reachableLink(actor, slug)
    const visible = await visibleAgentIds(actor)

    const data = grants ? await updatePageData(actor.workspaceId, slug, grants, visible) : null
    if (access) file = await updatePublishedAccess(actor.workspaceId, slug, access)

    if (grants && data) {
        const refused = grants.filter(grant => !data.listed.some(table => table.table === grant.table && table.database === grant.database && table.grant === grant.grant))
        return { ...linkView(file), tables: data, ...(refused.length > 0 ? { refused, note: 'These tables were not given: a table you do not reach can only be lowered or taken away. The others in `tables.others` are the ones you may give.' } : {}) }
    }
    if (access) return linkView(file)
    return { ...linkView(file), tables: await getPageData(actor.workspaceId, slug, visible) }
}

async function unpublish(actor: Actor, args: Record<string, unknown>) {
    requireConfirmation(args, 'the published link, whose address stops answering')
    const slug = requireString(args.slug, 'slug')
    await assertPublishedLinkInReach(actor, slug)
    await unpublishInWorkspace(actor.workspaceId, slug)
    return { slug, unpublished: true }
}

// Chained after the conversations: the template library comes next.
export async function dispatchPublishTool(actor: Actor, name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
        case 'list_published_pages':
            return listLinks(actor, args)
        case 'publish_file':
            return publish(actor, args)
        case 'update_published_page':
            return updateLink(actor, args)
        case 'unpublish_page':
            return unpublish(actor, args)
        default:
            return await dispatchLibraryTool(actor, name, args)
    }
}
