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

function InReadersLanguage({ text }: { text: (t: InstallFeedbackCopy) => string }) {
    const t = useTranslations('templates.installFeedback')
    return text(t)
}

const translated = (text: (t: InstallFeedbackCopy) => string) => <InReadersLanguage text={text} />

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

export function duplicateDescription(result: Duplicated, t: InstallFeedbackCopy): string {
    const notes: string[] = []
    if (result.inactive) notes.push(t('landedInactive'))
    if (result.triggers.length > 0) notes.push(t('webhooksMoved', { count: result.triggers.length }))
    if (!result.inactive && result.schedules.length > 0) notes.push(t('schedulesDoubled', { count: result.schedules.length }))
    return notes.length > 0 ? notes.join(' ') : t('copyReady')
}

export function reportInstall(result: Installed, title: string): void {
    if (result.alreadyInstalled) {
        toast.info(translated(t => t('alreadyOnBoard', { title })), { description: translated(t => t('alreadyOnBoardHint')) })
        return
    }
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
