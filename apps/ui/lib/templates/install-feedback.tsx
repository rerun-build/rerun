import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import type { DuplicateAgentResult } from '@/app/api/_actions/agent.actions'
import type { InstallSharedAgentResult } from '@/app/api/_actions/agent-share.actions'
import type { InstallTemplateResult } from '@/app/api/_actions/template.actions'
import { fireRerunConfetti } from '@/lib/confetti'

type Installed = Extract<InstallTemplateResult, { ok: true }>
type SharedInstalled = Extract<InstallSharedAgentResult, { ok: true }>
type Duplicated = Extract<DuplicateAgentResult, { ok: true }>

export type InstallFeedbackCopy = (
    key: 'alreadyOnBoard' | 'alreadyOnBoardHint' | 'notImported' | 'inactiveCount' | 'landed' | 'openOne' | 'landedInactive' | 'agentLanded' | 'openIt' | 'webhooksMoved' | 'schedulesDoubled' | 'copyReady',
    values?: Record<string, string | number>
) => string

// The toasts are raised from the board store, outside any component: the sentence is written when
// the toast renders, in the reader's language.
function InReadersLanguage({ text }: { text: (t: InstallFeedbackCopy) => string }) {
    const t = useTranslations('templates.installFeedback')
    return text(t)
}

const translated = (text: (t: InstallFeedbackCopy) => string) => <InReadersLanguage text={text} />

// What the user still has to do once a template landed: the connectors arrive disconnected. An agent
// placed but switched off looks installed and yet will do nothing, so it is said first.
export function installDescription(result: Installed, t: InstallFeedbackCopy): string {
    const problems = [...result.failed.map(failure => t('notImported', { name: failure.name })), ...result.warnings]
    if (result.inactive > 0) problems.unshift(t('inactiveCount', { count: result.inactive }))
    return problems.length > 0 ? problems.join(' ') : t('openOne')
}

export function shareInstallDescription(result: SharedInstalled, t: InstallFeedbackCopy): string {
    const problems = [...result.warnings]
    if (result.inactive) problems.unshift(t('landedInactive'))
    return problems.length > 0 ? problems.join(' ') : t('openIt')
}

// A copy has nothing to install: it keeps its keys, its signed-in connectors and its pinned model.
// What it cannot tell by itself are its two side effects: the webhooks changed address, and the
// periodic work now happens twice.
export function duplicateDescription(result: Duplicated, t: InstallFeedbackCopy): string {
    const notes: string[] = []
    if (result.inactive) notes.push(t('landedInactive'))
    if (result.triggers.length > 0) notes.push(t('webhooksMoved', { count: result.triggers.length }))
    if (!result.inactive && result.schedules.length > 0) notes.push(t('schedulesDoubled', { count: result.schedules.length }))
    return notes.length > 0 ? notes.join(' ') : t('copyReady')
}

// Both entry points (importing into an existing space, and replaying a parked template after
// checkout) report the same thing.
export function reportInstall(result: Installed, title: string): void {
    if (result.alreadyInstalled) {
        toast.info(translated(t => t('alreadyOnBoard', { title })), { description: translated(t => t('alreadyOnBoardHint')) })
        return
    }
    // The logo rain greets agents that really land, not the drop on the ghost block: during
    // onboarding that one is followed by the account and the payment.
    if (result.imported > 0) void fireRerunConfetti()
    toast.success(translated(t => t('landed', { count: result.imported, title })), { description: translated(t => installDescription(result, t)) })
}

export function reportShareInstall(result: SharedInstalled): void {
    if (!result.inactive) void fireRerunConfetti()
    toast.success(translated(t => t('agentLanded', { name: result.agentName })), { description: translated(t => shareInstallDescription(result, t)) })
}

export function reportDuplicate(result: Duplicated): void {
    if (!result.inactive) void fireRerunConfetti()
    toast.success(translated(t => t('agentLanded', { name: result.agentName })), { description: translated(t => duplicateDescription(result, t)) })
}
