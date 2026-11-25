import 'server-only'

import { isAdminActor, type Actor } from '@/app/api/_auth/access'
import { workspaceFounderUserId } from '@/app/api/_auth/ownership'
import { earliestOrganizationStaff } from '@/app/api/_auth/workspace-members'
import { dispatchAccountTool } from '@/app/api/_services/mcp-account.service'
import { entryAfter } from '@/app/api/_services/mcp-vault.service'
import { addVaultMcp, addVaultService } from '@/app/api/_services/vault-install.service'
import { shareVaultEntry } from '@/app/api/_services/vault.service'
import { dispatchBoxTool } from '@/lib/foreman/box-tools'
import { dispatchInboxTool } from '@/lib/foreman/inbox-tools'
import { FOREMAN_ENGINE_HUB_TOOL_NAMES, FOREMAN_ENGINE_ONBOARDING_TOOL_NAMES, accountToolNameOf } from '@/lib/foreman/engine-brief'
import { dispatchWorkspaceOnboardingTool } from '@/lib/foreman/onboarding-tools'
import { FOREMAN_NAME_MAX, sanitizeForemanName } from '@/lib/foreman/name'
import { firstCoworkersOffer } from '@/lib/foreman/prompt'
import { saveForemanName } from '@/lib/foreman/profile'
import { workspaceBrand } from '@/lib/brand/workspace'
import { searchDocs } from '@/lib/foreman/search-docs'
import { FOREMAN_BOX_TOOL_DEFS, FOREMAN_INBOX_TOOL_DEFS } from '@/lib/foreman/tool-defs'
import { asString, asStringArray, requireString } from '@/lib/mcp/args'
import { inviteMember, resolveWorkspaceIdentities } from '@/app/api/_services/members.service'
import { failure } from '@/lib/i18n/action-error'
import { readCompanySite, saveCompanySite, skipCompanySite } from '@/lib/company/company-site'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectSingle } from '@/supabase/supabase-helpers'
import { platformHost } from '@rerun/contracts'

const BOX_TOOL_NAMES = new Set<string>(FOREMAN_BOX_TOOL_DEFS.map(def => def.name))
const INBOX_TOOL_NAMES = new Set<string>(FOREMAN_INBOX_TOOL_DEFS.map(def => def.name))

// What the engine foreman may do to its workspace, and nothing more: the same allowlist the hub
// hands it as its belt, so a tool name it was never given is refused here too.
export async function dispatchForemanHubTool(actor: Actor, tool: string, args: Record<string, unknown>): Promise<unknown> {
    const workspaceId = actor.workspaceId
    if (!FOREMAN_ENGINE_HUB_TOOL_NAMES.has(tool)) throw new Error(`Unknown foreman tool: ${tool}`)

    if (tool === 'search_docs') return searchDocs(requireString(args.query, 'query'), await workspaceBrand(workspaceId))
    if (tool === 'set_name') return setName(actor, args)
    if (tool === 'invite_members') return inviteMembers(actor, args)
    if (tool === 'save_company_website') return saveCompanyWebsite(actor, args)
    if (INBOX_TOOL_NAMES.has(tool)) return dispatchInboxTool(actor, tool, args)
    if (tool === 'add_vault_entry') return addVaultEntry(actor, args)

    // The turn speaks for the member who wrote it: a Box they create is theirs to manage, a coworker
    // lands only in a Box they manage, and only their Boxes are listed. A turn with nobody behind it
    // speaks for the workspace, as the account owner.
    const userId = actor.kind === 'user' ? actor.userId : await founderOf(workspaceId)
    if (BOX_TOOL_NAMES.has(tool)) return dispatchBoxTool({ workspaceId, userId, actor }, tool, args)
    if (FOREMAN_ENGINE_ONBOARDING_TOOL_NAMES.has(tool)) return dispatchWorkspaceOnboardingTool({ supabase: createServiceRoleClient(), userId, workspace: { id: workspaceId }, actor }, tool, args)

    return dispatchAccountTool(actor, accountToolNameOf(tool), args, { actorUserId: actor.kind === 'user' ? actor.userId : null })
}

// An organization sets a workspace up before anyone of its own is in it: until then, its team stands
// for it.
async function founderOf(workspaceId: number): Promise<string> {
    const userId = (await workspaceFounderUserId(workspaceId)) ?? (await earliestOrganizationStaff(createServiceRoleClient(), workspaceId))
    if (!userId) throw new Error('This workspace has no member to act for.')
    return userId
}

async function setName(actor: Actor, args: Record<string, unknown>): Promise<{ name: string }> {
    if (!isAdminActor(actor)) throw new Error('Only an admin of the workspace can rename you. Tell the user to ask one.')
    const name = sanitizeForemanName(args.name)
    if (!name) throw new Error(`That name cannot be used: 1 to ${FOREMAN_NAME_MAX} letters, digits, spaces, dots, apostrophes or hyphens.`)
    await saveForemanName({ supabase: createServiceRoleClient(), workspace: { id: actor.workspaceId } }, name)
    return { name }
}

async function saveCompanyWebsite(actor: Actor, args: Record<string, unknown>) {
    if (!isAdminActor(actor)) throw new Error('Only an admin of the workspace can save its website. Tell the user to ask one.')
    const supabase = createServiceRoleClient()
    const { workspaceId } = actor
    if (args.none === true) {
        const answers = await skipCompanySite({ supabase, workspaceId })
        return { saved: false, next: firstCoworkersOffer(answers.industry) }
    }
    const input = requireString(args.url, 'url')
    const platform = platformHost(input)
    if (platform) throw new Error(`${platform} is a platform, not the website of their company. Ask for their own address, or whether they have none.`)
    const site = await readCompanySite(input)
    if (!site) throw new Error('That does not look like a website address. Ask them for it again.')
    const userId = actor.kind === 'user' ? actor.userId : await founderOf(workspaceId)
    const answers = await saveCompanySite({ supabase, workspaceId, userId }, site)
    return { saved: true, url: site.url, company: site.profile, next: `${site.profile ? 'Say in one sentence what you understood of their company.' : 'The site could not be read: say so in one short line, and never invent what they do.'} ${firstCoworkersOffer(answers.industry)}` }
}

// Added with the checks of the Vault's own Add page, then left for the user to sign in to: no value
// ever comes through here.
async function addVaultEntry(actor: Actor, args: Record<string, unknown>) {
    const agentIds = asStringArray(args.agentIds)
    const kind = asString(args.kind)
    const sharedWithAll = args.sharedWithAll === true
    if (sharedWithAll && !isAdminActor(actor)) throw new Error('Only an admin gives an entry to every coworker. Add it for the coworkers you name instead, or ask an admin.')
    let entryId: string
    if (kind === 'app') {
        entryId = (await addVaultService({ slug: requireString(args.slug, 'slug'), agentIds }, actor)).item.id
        if (sharedWithAll) await shareVaultEntry(entryId, true, actor)
    } else if (kind === 'mcp') {
        entryId = (await addVaultMcp({ name: requireString(args.name, 'name'), url: asString(args.url), command: asString(args.command), args: asStringArray(args.args), agentIds, sharedWithAll }, actor)).id
    } else {
        throw new Error('kind must be "app" or "mcp".')
    }
    return entryAfter(actor, entryId)
}

const MAX_INVITES = 10

// The invitations an admin confirmed in the conversation, sent as the dialog sends them, in the name
// of the admin the turn speaks for (the founder for a turn with nobody behind it).
async function inviteMembers(actor: Actor, args: Record<string, unknown>): Promise<{ invitations: Array<{ email: string; sent: boolean; inviteUrl?: string; error?: string }> }> {
    if (!isAdminActor(actor)) throw new Error('Only an admin of the workspace can invite people. Tell the user to ask one.')
    const emails = [...new Set(asStringArray(args.emails).map(email => email.trim().toLowerCase()))]
    if (!emails.length) throw new Error('Pass the addresses the user confirmed in emails.')
    if (emails.length > MAX_INVITES) throw new Error(`Invite at most ${MAX_INVITES} people at once.`)
    const supabase = createServiceRoleClient()
    const userId = actor.kind === 'user' ? actor.userId : await founderOf(actor.workspaceId)
    const [{ data: workspace }, inviters] = await Promise.all([selectSingle(supabase, 'workspaces', ['id', 'name', 'max_seats'] as const, { id: actor.workspaceId }), resolveWorkspaceIdentities(supabase, actor.workspaceId, [userId])])
    if (!workspace) throw new Error('This workspace no longer exists.')
    const scope = asString(args.scope) === 'assigned' ? 'assigned' : 'all'
    const invitations = []
    for (const email of emails) {
        const result = await inviteMember({ supabase, workspace, invitedBy: { userId, email: inviters.get(userId)?.email ?? null } }, email, scope)
        invitations.push(result.ok ? { email, sent: true, ...(result.inviteUrl ? { inviteUrl: result.inviteUrl } : {}) } : { email, sent: false, error: 'code' in result ? failure(result.code).error : result.error })
    }
    return { invitations }
}

