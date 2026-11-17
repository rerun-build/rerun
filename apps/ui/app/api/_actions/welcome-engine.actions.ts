'use server'

import { requireAdminContext, type WorkspaceContext } from '@/app/api/_auth/ownership'
import { ensureWorkspaceEngine, findWorkspaceEngine } from '@/app/api/_services/workspace-engine.service'
import { getEngineHealth } from '@/lib/engine/client'
import { readAnswers, writeAnswers } from '@/lib/foreman/profile'
import { failureOf } from '@/lib/i18n/action-error'
import type { ActionResult } from './space.actions'

// The end of the welcome page: the workspace's machine, then the hand-over to its Chief of Staff.
// On Rerun Cloud the machine is a box of the pool, claimed in one write; on a self-hosted install it
// is the engine of the compose. Either way the page shows each milestone as it really happens.

async function welcomeContext(): Promise<WorkspaceContext> {
    const ctx = await requireAdminContext()
    if (ctx.authUser.is_anonymous) throw new Error('Create your account first.')
    return ctx
}

/** Claims the machine, once: a second call finds it claimed and answers at once. */
export async function claimWelcomeEngineAction(): Promise<ActionResult> {
    try {
        const ctx = await welcomeContext()
        const claim = await ensureWorkspaceEngine(ctx.workspace.id)
        return claim.ok ? { ok: true } : claim
    } catch (err) {
        return failureOf(err, 'noMachine')
    }
}

/** Whether the machine answers. The page asks again until it does. */
export async function welcomeEngineAnswersAction(): Promise<boolean> {
    const ctx = await welcomeContext()
    const engine = await findWorkspaceEngine(ctx.workspace.id)
    if (!engine) return false
    return getEngineHealth(engine.conn).then(
        () => true,
        () => false
    )
}

/**
 * Closes the onboarding: the workspace is stamped onboarded, which is what lets the Chief of Staff of
 * its engine take over, and the first turn it owes them is marked, for it to speak first, once.
 */
export async function finishWelcomeAction(): Promise<ActionResult> {
    try {
        const ctx = await welcomeContext()
        if (ctx.workspace.onboarded_at) return { ok: true }
        const answers = await readAnswers(ctx)
        await writeAnswers(ctx, { ...answers, onboarding: { ...answers.onboarding, greetPending: true } }, true)
        return { ok: true }
    } catch (err) {
        return failureOf(err, 'saveAnswerFailed')
    }
}
