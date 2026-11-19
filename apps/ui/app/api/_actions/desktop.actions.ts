'use server'

import { desktopAppSchema, desktopViewModeSchema, takeoverUrlSchema, type DesktopApp, type DesktopViewMode, type TakeoverResult } from '@moldwright/contracts'

import { assertAgentInWorkspace, deniedCode, type DeniedCode } from '@/app/api/_auth/access'
import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { DesktopUnavailableError, desktopSocketUrl, resolveWorkspaceDesktop, type WorkspaceDesktop } from '@/app/api/_services/desktop.service'
import { NoEngineError } from '@/app/api/_services/workspace-engine.service'
import { finishTakeover, openDesktopApp, startDesktop, startTakeover } from '@/lib/engine/client'
import { failure, failureOf, type ActionFailure } from '@/lib/i18n/action-error'

type Failure = ActionFailure & { denied?: DeniedCode }

function failed(err: unknown): Failure {
    if (err instanceof DesktopUnavailableError || err instanceof NoEngineError) return failureOf(err)
    const denied = deniedCode(err)
    if (denied && err instanceof Error) return { ...failureOf(err), denied }
    console.error('[desktop]', err)
    return failure('desktopUnreachable')
}

async function memberDesktop(): Promise<WorkspaceDesktop> {
    const ctx = await requireWorkspaceContext()
    if (ctx.authUser.is_anonymous) throw new DesktopUnavailableError('desktopNeedsAccount')
    return resolveWorkspaceDesktop(ctx.workspace.id)
}

async function engineAgentId(agentId: string): Promise<string> {
    const agent = await assertAgentInWorkspace(agentId)
    if (!agent.engine_agent_id) throw new DesktopUnavailableError('coworkerNotOnMachine')
    return agent.engine_agent_id
}

export type DesktopSocket = { ok: true; socketUrl: string; dock: boolean } | Failure

export async function openDesktopAction(agentId: string, mode: DesktopViewMode, timeZone?: string): Promise<DesktopSocket> {
    try {
        const [desktop, engineId] = await Promise.all([memberDesktop(), engineAgentId(agentId)])
        const { screens } = await startDesktop(desktop.conn, engineId, timeZone)
        const dock = screens.find(screen => screen.agentId === engineId)?.dock ?? false
        return { ok: true, socketUrl: desktopSocketUrl(desktop, engineId, desktopViewModeSchema.parse(mode)), dock }
    } catch (err) {
        return failed(err)
    }
}

export async function launchDesktopAppAction(agentId: string, app: DesktopApp): Promise<{ ok: true } | Failure> {
    try {
        const [desktop, engineId] = await Promise.all([memberDesktop(), engineAgentId(agentId)])
        await openDesktopApp(desktop.conn, engineId, desktopAppSchema.parse(app))
        return { ok: true }
    } catch (err) {
        return failed(err)
    }
}

export async function startTakeoverAction(agentId: string, url?: string): Promise<{ ok: true } | Failure> {
    try {
        const [desktop, engineId] = await Promise.all([memberDesktop(), engineAgentId(agentId)])
        await startTakeover(desktop.conn, engineId, takeoverUrlSchema.optional().safeParse(url).data)
        return { ok: true }
    } catch (err) {
        return failed(err)
    }
}

export async function finishTakeoverAction(agentId: string, { keepOpen = false } = {}): Promise<({ ok: true } & TakeoverResult) | Failure> {
    try {
        const [desktop, engineId] = await Promise.all([memberDesktop(), engineAgentId(agentId)])
        const { url, open } = await finishTakeover(desktop.conn, engineId, { keepOpen })
        return { ok: true, url, open }
    } catch (err) {
        return failed(err)
    }
}
