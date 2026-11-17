'use server'

import { remoteComputerRuleSchema, remoteComputerSettingsPatchSchema, remoteOsSchema, type RemoteComputerRule, type RemoteComputerSettingsPatch, type RemoteOs } from '@rerun/contracts'
import { z } from 'zod'

import { requireWorkspaceContext, type WorkspaceContext } from '@/app/api/_auth/ownership'
import { resolveMemberIdentities } from '@/app/api/_services/members.service'
import { addComputerRule, computerIdByHandle, computerJobLogs, computerJobs, linkComputer, listWorkspaceComputers, renameComputer, revokeComputer, stopComputerJob, updateComputerSettings, type WorkspaceComputer } from '@/app/api/_services/remote-computers.service'
import type { RemoteJob, RemoteJobLogs } from '@rerun/contracts'
import type { ComputerItem, ComputersList, ComputerStatus } from '@/lib/computers/types'
import { AppError, failure, failureOf, type ActionFailure } from '@/lib/i18n/action-error'
import { remoteComputersFlag } from '@/flags'

async function computersContext(): Promise<WorkspaceContext> {
    const ctx = await requireWorkspaceContext()
    if (ctx.authUser.is_anonymous || !(await remoteComputersFlag().catch(() => false))) throw new AppError('computersOff')
    return ctx
}

const canManage = (ctx: WorkspaceContext, computer: Pick<WorkspaceComputer, 'linked_by'>) => ctx.role === 'admin' || computer.linked_by === ctx.userId

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
        canManage: canManage(ctx, computer),
    }))
}

export async function listComputersAction(): Promise<({ ok: true } & ComputersList) | ActionFailure> {
    try {
        const ctx = await computersContext()
        const { computers, engine } = await listWorkspaceComputers(ctx.workspace.id)
        return { ok: true, computers: await toItems(ctx, computers), engine }
    } catch (err) {
        return failureOf(err)
    }
}

const linkSchema = z.object({
    name: z.string(),
    os: remoteOsSchema,
    arch: z.string().max(32),
    hostname: z.string().max(255),
    appVersion: z.string().max(64),
})

export type LinkThisComputerInput = { name: string; os: RemoteOs; arch: string; hostname: string; appVersion: string }

// Called by the page inside the desktop app, which hands the token straight to the app: it is shown
// to nothing else and never stored by the page.
export async function linkThisComputerAction(input: LinkThisComputerInput): Promise<{ ok: true; computer: { id: string; name: string; handle: string }; token: string; workspace: { id: number; name: string } } | ActionFailure> {
    try {
        const ctx = await computersContext()
        const parsed = linkSchema.safeParse(input)
        if (!parsed.success) return failure('computerNameInvalid')
        const { computer, token } = await linkComputer({ workspaceId: ctx.workspace.id, userId: ctx.userId, ...parsed.data })
        return { ok: true, computer: { id: computer.id, name: computer.name, handle: computer.handle }, token, workspace: { id: ctx.workspace.id, name: ctx.workspace.name ?? '' } }
    } catch (err) {
        return failureOf(err)
    }
}

async function managedComputer(computerId: string): Promise<{ ctx: WorkspaceContext; computer: WorkspaceComputer }> {
    const ctx = await computersContext()
    const { computers } = await listWorkspaceComputers(ctx.workspace.id)
    const computer = computers.find(item => item.id === computerId)
    if (!computer) throw new AppError('computerNotFound')
    if (!canManage(ctx, computer)) throw new AppError('computersAdminOnly')
    return { ctx, computer }
}

export async function renameComputerAction(computerId: string, name: string): Promise<{ ok: true } | ActionFailure> {
    try {
        const { ctx } = await managedComputer(computerId)
        await renameComputer(ctx.workspace.id, computerId, name)
        return { ok: true }
    } catch (err) {
        return failureOf(err)
    }
}

export async function updateComputerSettingsAction(computerId: string, patch: RemoteComputerSettingsPatch): Promise<{ ok: true } | ActionFailure> {
    try {
        const settings = remoteComputerSettingsPatchSchema.safeParse(patch)
        if (!settings.success) return failure('generic')
        const { ctx } = await managedComputer(computerId)
        await updateComputerSettings(ctx.workspace.id, computerId, settings.data)
        return { ok: true }
    } catch (err) {
        return failureOf(err)
    }
}

export async function unlinkComputerAction(computerId: string): Promise<{ ok: true } | ActionFailure> {
    try {
        const { ctx } = await managedComputer(computerId)
        await revokeComputer(ctx.workspace.id, computerId)
        return { ok: true }
    } catch (err) {
        return failureOf(err)
    }
}

// "Always allow" on a computer's card: any member who may answer the card may keep the answer, as
// any member may use the computer through the coworkers.
export async function allowOnComputerAction(computerId: string, rule: RemoteComputerRule): Promise<{ ok: true } | ActionFailure> {
    try {
        const parsed = remoteComputerRuleSchema.safeParse(rule)
        if (!parsed.success) return failure('generic')
        const ctx = await computersContext()
        await addComputerRule(ctx.workspace.id, computerId, parsed.data)
        return { ok: true }
    } catch (err) {
        return failureOf(err)
    }
}

// The jobs a computer runs, for its detail. `jobs` is null while the computer is offline.
export async function computerJobsAction(computerId: string): Promise<{ ok: true; jobs: RemoteJob[] | null } | ActionFailure> {
    try {
        const ctx = await computersContext()
        return { ok: true, jobs: await computerJobs(ctx.workspace.id, computerId) }
    } catch (err) {
        return failureOf(err)
    }
}

// One job as the chat card shows it, read from the computer named by its #handle.
export async function computerJobAction(handle: string, jobId: string): Promise<{ ok: true; logs: RemoteJobLogs | null } | ActionFailure> {
    try {
        const ctx = await computersContext()
        return { ok: true, logs: await computerJobLogs(ctx.workspace.id, handle, jobId) }
    } catch (err) {
        return failureOf(err)
    }
}

// Any member may stop a job: any member may start one through their coworkers.
export async function stopComputerJobAction(computer: { id?: string; handle?: string }, jobId: string): Promise<{ ok: true; job: RemoteJob | null } | ActionFailure> {
    try {
        const ctx = await computersContext()
        const computerId = computer.id ?? (await computerIdByHandle(ctx.workspace.id, computer.handle ?? ''))
        return { ok: true, job: await stopComputerJob(ctx.workspace.id, computerId, jobId) }
    } catch (err) {
        return failureOf(err)
    }
}
