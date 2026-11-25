import 'server-only'
import { remoteOsSchema } from '@rerun/contracts'

import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { resolveWorkspaceIdentities } from '@/app/api/_services/members.service'
import { hasLinkedComputers, listWorkspaceComputers, type WorkspaceComputer } from '@/app/api/_services/remote-computers.service'
import type { ComputerItem, ComputersList, ComputerStatus } from '@/lib/computers/types'
import { AppError } from '@/lib/i18n/action-error'

// A visitor who has not created an account has a workspace too, and no computers.
export function assertComputersFor(ctx: WorkspaceContext): void {
    if (ctx.authUser.is_anonymous) throw new AppError('computersOff')
}

export function computersOpenTo(ctx: WorkspaceContext): boolean {
    return !ctx.authUser.is_anonymous
}

// An admin, or the person who linked it.
export const canManageComputer = (ctx: WorkspaceContext, computer: Pick<WorkspaceComputer, 'linked_by'>) => ctx.role === 'admin' || computer.linked_by === ctx.userId

function statusOf(computer: WorkspaceComputer): ComputerStatus {
    const view = computer.view
    if (!view?.online) return 'offline'
    if (view.paused) return 'paused'
    return view.runningJobs > 0 ? 'busy' : 'online'
}

async function toItems(ctx: WorkspaceContext, computers: WorkspaceComputer[]): Promise<ComputerItem[]> {
    const people = await resolveWorkspaceIdentities(ctx.supabase, ctx.workspace.id, [...new Set(computers.flatMap(computer => (computer.linked_by ? [computer.linked_by] : [])))])
    const linkerOf = (userId: string | null) => {
        if (!userId) return null
        const person = people.get(userId)
        return { id: person?.id ?? userId, name: person?.name ?? person?.email ?? '' }
    }
    return computers.map(computer => ({
        id: computer.id,
        name: computer.name,
        handle: computer.handle,
        os: remoteOsSchema.catch('linux').parse(computer.os),
        arch: computer.arch,
        hostname: computer.hostname,
        appVersion: computer.view?.appVersion ?? computer.app_version,
        linkedBy: linkerOf(computer.linked_by),
        linkedAt: computer.created_at,
        lastSeenAt: computer.view?.lastSeenAt ?? computer.last_seen_at,
        status: statusOf(computer),
        capabilities: computer.view?.capabilities ?? [],
        facts: computer.view?.facts ?? null,
        settings: computer.view?.settings ?? null,
        runningJobs: computer.view?.runningJobs ?? 0,
        canManage: canManageComputer(ctx, computer),
    }))
}

export async function workspaceComputerItems(ctx: WorkspaceContext): Promise<ComputersList> {
    const { computers, engine } = await listWorkspaceComputers(ctx.workspace.id)
    return { computers: await toItems(ctx, computers), engine }
}

// What `#` offers in a composer, read each time one opens. A workspace without a computer, nearly
// all of them, answers without a call to its box.
export async function mentionComputerItems(ctx: WorkspaceContext): Promise<ComputersList> {
    if (!(await hasLinkedComputers(ctx.workspace.id))) return { computers: [], engine: 'none' }
    return workspaceComputerItems(ctx)
}
