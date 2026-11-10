'use client'

import { useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Badge, type BadgeTone } from '@rerun/ui/primitives'
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Download, Trash2Icon } from '@/lib/icons'
import type { ExpertTemplateAgent } from '@/lib/templates/expert'

// The answer is given on the agent itself, in its Install tab or during the capture review. Here it
// is only reported, because it is what a submission is blocked on.
const SETUP_BADGE: Record<string, { label: 'guided' | 'none' | 'missing'; tone: BadgeTone }> = {
    true: { label: 'guided', tone: 'brand' },
    false: { label: 'none', tone: 'neutral' },
    null: { label: 'missing', tone: 'orange' },
}

// An agent is here because a capture archived its folder: it is never hand-authored, only captured
// and removed. Everything is `type="button"` so the block can live inside the editor form without
// submitting it.
export function ExpertTemplateAgents({
    agents,
    readOnly,
    onCapture,
    onRemove,
}: {
    agents: ExpertTemplateAgent[]
    readOnly: boolean
    onCapture: () => void
    onRemove: (agentKey: string) => Promise<boolean>
}) {
    const t = useTranslations('templates.expert.agents')
    const [pending, startTransition] = useTransition()

    return (
        <Field label={t('title', { count: agents.length })}>
            <div className="flex flex-col gap-2">
                {agents.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                        {t('empty')}
                    </p>
                ) : (
                    agents.map(agent => (
                        <div key={agent.key} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                            <div className="flex min-w-0 flex-col">
                                <span className="truncate text-sm">{agent.name}</span>
                                <span className="truncate text-xs text-muted-foreground">
                                    {agent.role || t('noRole')}
                                    {agent.connectorSlugs.length > 0 && ` · ${t('connectors', { count: agent.connectorSlugs.length })}`}
                                </span>
                            </div>

                            <Badge size="xs" glow={false} tone={SETUP_BADGE[String(agent.setupRequired)].tone} className="ml-auto shrink-0">
                                {t(`setup.${SETUP_BADGE[String(agent.setupRequired)].label}`)}
                            </Badge>

                            {!readOnly && (
                                <ConfirmDialog
                                    title={t('removeTitle', { name: agent.name })}
                                    description={t('removeDescription')}
                                    confirmLabel={t('removeConfirm')}
                                    onConfirm={() =>
                                        startTransition(async () => {
                                            await onRemove(agent.key)
                                        })
                                    }
                                >
                                    <Button
                                        type="button"
                                        size="icon-sm"
                                        variant="ghost"
                                        disabled={pending}
                                        title={t('removeLabel', { name: agent.name })}
                                        aria-label={t('removeLabel', { name: agent.name })}
                                        className="shrink-0 text-muted-foreground hover:text-destructive"
                                    >
                                        <Trash2Icon className="size-3.5" />
                                    </Button>
                                </ConfirmDialog>
                            )}
                        </div>
                    ))
                )}

                {!readOnly && (
                    <>
                        <Button type="button" size="sm" variant="secondary" onClick={onCapture} className="self-start">
                            <Download className="size-3.5" />
                            {t('capture')}
                        </Button>
                        {agents.length > 0 && (
                            <p className="text-xs text-muted-foreground">
                                {t('removeNote')}
                            </p>
                        )}
                    </>
                )}
            </div>
        </Field>
    )
}
