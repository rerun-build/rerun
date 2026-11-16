import 'server-only'

import { isAdminActor, type Actor } from '@/app/api/_auth/access'
import type { Database } from '@/app/api/database.types'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { FOREMAN_IDENTITY_TOOL_DEFS } from './tool-defs'

type WorkspaceUpdate = Database['public']['Tables']['workspaces']['Update']

export const FOREMAN_IDENTITY_TOOL_NAMES: ReadonlySet<string> = new Set(FOREMAN_IDENTITY_TOOL_DEFS.map(def => def.name))

const ASSISTANT_NAME_MAX = 40

// One line, a few words: whatever else is in it was not a name.
function cleanAssistantName(value: unknown): string | null | 'invalid' {
    if (typeof value !== 'string') return 'invalid'
    const name = value.replace(/\s+/g, ' ').trim()
    if (!name) return null
    return name.length > ASSISTANT_NAME_MAX ? 'invalid' : name
}

// The name is the workspace's: an admin gives it, from the chat or the app.
async function setAssistantName(actor: Actor, value: unknown): Promise<{ name: string | null }> {
    if (!isAdminActor(actor)) throw new Error('Only an admin of the workspace can give you a name: say so, and suggest they ask one.')
    const name = cleanAssistantName(value)
    if (name === 'invalid') throw new Error(`A name is one line of ${ASSISTANT_NAME_MAX} characters at most.`)
    const { error } = await createServiceRoleClient().from('workspaces').update<WorkspaceUpdate>({ assistant_name: name }).eq('id', actor.workspaceId)
    if (error) throw new Error(error.message)
    return { name }
}

export async function dispatchForemanIdentityTool(actor: Actor, tool: string, args: Record<string, unknown>): Promise<unknown> {
    if (tool !== 'set_assistant_name') throw new Error(`Unknown identity tool: ${tool}`)
    const { name } = await setAssistantName(actor, args.name)
    return name ? { name, message: `Your name in this workspace is now ${name}.` } : { name: null, message: 'You are the Chief of Staff again, without a name of your own.' }
}
