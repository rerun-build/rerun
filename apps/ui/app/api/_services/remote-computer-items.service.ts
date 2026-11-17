import 'server-only'
import { remoteOsSchema } from '@rerun/contracts'

import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { resolveMemberIdentities } from '@/app/api/_services/members.service'
import { listWorkspaceComputers, type WorkspaceComputer } from '@/app/api/_services/remote-computers.service'
import type { ComputerItem, ComputersList, ComputerStatus } from '@/lib/computers/types'
import { AppError } from '@/lib/i18n/action-error'
import { REMOTE_COMPUTERS_RELEASED } from '@/lib/features'
import { releasedOrEarlyAccess } from '@/flags'

// A visitor who has not created an account has a workspace too, and no computers.
export function assertComputersFor(ctx: WorkspaceContext): void {
    if (ctx.authUser.is_anonymous) throw new AppError('computersOff')
}

// The flag, for a caller known by its bearer token (the iOS app) rather than by the browser's cookies.
export function computersOpenTo(ctx: WorkspaceContext): boolean {
    return !ctx.authUser.is_anonymous && releasedOrEarlyAccess(REMOTE_COMPUTERS_RELEASED, ['rerun.local'])({ entities: { user: ctx.userEmail ? { email: ctx.userEmail.toLowerCase() } : undefined } })
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
    const people = await resolveMemberIdentities(ctx.supabase, [...new Set(computers.flatMap(computer => (computer.linked_by ? [computer.linked_by] : [])))])
    return computers.map(computer => ({
        id: computer.id,
        name: computer.name,
        handle: computer.handle,
        os: remoteOsSchema.catch('linux').parse(computer.os),
        arch: computer.arch,
        hostname: computer.hostname,
        appVersion: computer.view?.appVersion ?? computer.app_version,
        linkedBy: computer.linked_by ? { id: computer.linked_by, name: people.get(computer.linked_by)?.name ?? people.get(computer.linked_by)?.email ?? '' } : null,
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
