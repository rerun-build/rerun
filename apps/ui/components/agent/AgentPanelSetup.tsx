'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { isSetupAnswered } from '@rerun/contracts'
import { getAgentDetailAction, updateAgentConfigAction } from '@/app/api/_actions/agent.actions'
import { invalidateAgentContext } from '@/hooks/useAgentContext'
import { AgentSetupFields, type AgentSetupDraft } from '@/components/agent/AgentSetupFields'
import { Button } from '@/components/ui/button'
import { SkeletonForm } from '@/components/ui/skeleton'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { useCanManageAgent } from '@/hooks/useBoxAccess'
import { useBoxManageReason } from '@/hooks/useBoxManageReason'
import { CheckIcon, Loader2Icon } from '@/lib/icons'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

export function AgentPanelSetup({ agentId }: { agentId: string }) {
    const boxManageReason = useBoxManageReason()
    const t = useTranslations('agent.agentPanelSetup')
    const errorText = useErrorText()
    const [draft, setDraft] = useState<AgentSetupDraft>({ required: null, prompt: '' })
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [saved, setSaved] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const canManage = useCanManageAgent(agentId)

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        getAgentDetailAction(agentId)
            .then(detail => {
                if (cancelled) return
                if (!detail) {
                    setError(t('unreachable'))
                    return
                }
                setDraft({ required: detail.config.setup.required, prompt: detail.install })
            })
            .catch(() => !cancelled && setError(t('unreachable')))
            .finally(() => !cancelled && setLoading(false))
        return () => {
            cancelled = true
        }
    }, [agentId, t])

    const save = async () => {
        setError(null)
        setSaving(true)
        // The author never installs their own agent, so it is marked done here and now. Only the
        // copy an import creates starts pending, which is what puts the button in front of a buyer.
        const result = await updateAgentConfigAction(agentId, {
            setup: { required: draft.required, completedAt: new Date().toISOString() },
            install: draft.required ? draft.prompt : '',
        })
        setSaving(false)
        if (!result.success) {
            setError(errorText(result, t('saveFailed')))
            return
        }
        invalidateAgentContext(agentId)
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
    }

    if (loading) {
        return (
            <div className="flex flex-col gap-4 p-4">
                <SkeletonForm />
            </div>
        )
    }

    return (
        <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
            <p className="text-xs text-muted-foreground">
                {t('intro')}
            </p>

            {error && <p className="text-xs text-destructive">{error}</p>}

            <AgentSetupFields value={draft} onChange={setDraft} disabled={saving || !canManage} />

            <TooltipDisabledReason reason={canManage ? undefined : boxManageReason} className="flex w-full">
                <Button type="button" size="sm" onClick={save} disabled={saving || !canManage || !isSetupAnswered(draft)} className="w-full">
                    {saved ? (
                        <>
                            <CheckIcon className="mr-1.5 size-3.5 text-emerald-500" /> {t('saved')}
                        </>
                    ) : saving ? (
                        <>
                            <Loader2Icon className="mr-1.5 size-3.5 animate-spin" /> {t('saving')}
                        </>
                    ) : (
                        t('save')
                    )}
                </Button>
            </TooltipDisabledReason>
        </div>
    )
}
