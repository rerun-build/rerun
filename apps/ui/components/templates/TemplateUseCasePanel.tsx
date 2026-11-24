'use client'

import { AgentBuddy } from '@rerun/ui/iso-grid'
import { ScrollFade } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import { TemplateDetailApps } from '@/components/templates/TemplateDetailApps'
import { TemplateDetailFooter } from '@/components/templates/TemplateDetailFooter'
import { TemplateDetailMedia } from '@/components/templates/TemplateDetailMedia'
import { TemplateDetailUseCases } from '@/components/templates/TemplateDetailUseCases'
import { ChevronRightIcon } from '@/lib/icons'
import { coworkerUseCases, type UseCase } from '@/lib/templates/use-cases'

// A use case is installed with the coworker that carries it, and that coworker with its whole
// template: the board on top and the footer are the template's own.
export function TemplateUseCasePanel({ useCase, showStatus, onSelectUseCase, onSelectCoworker, onImported }: { useCase: UseCase; showStatus: boolean; onSelectUseCase: (useCase: UseCase) => void; onSelectCoworker: () => void; onImported: () => void }) {
    const t = useTranslations('templates.detail')
    const { template, agent } = useCase
    const others = coworkerUseCases(template)
        .flatMap(coworker => (coworker.agent.key === agent.key ? coworker.useCases : []))
        .filter(other => other.id !== useCase.id)

    return (
        <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
            <ScrollFade className="min-h-0 flex-1">
                <TemplateDetailMedia template={template} showStatus={showStatus} />

                <div className="flex flex-col gap-5 p-5">
                    <div className="space-y-1.5">
                        <h3 className="text-base font-medium break-words">{useCase.name}</h3>
                        {useCase.summary && <p className="text-xs leading-relaxed text-muted-foreground">{useCase.summary}</p>}
                    </div>

                    <button
                        type="button"
                        onClick={onSelectCoworker}
                        className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/30 p-3 text-left transition-colors outline-none hover:bg-accent/30 focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                        <AgentBuddy agentId={agent.key} size={36} facing="right" className="shrink-0" />
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{agent.name}</span>
                            <span className="block truncate text-xs text-muted-foreground">{template.title}</span>
                        </span>
                        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
                    </button>

                    <TemplateDetailUseCases title={t('alsoDoes', { coworker: agent.name })} useCases={others} onSelect={onSelectUseCase} />
                    <TemplateDetailApps connectors={useCase.connectors} />
                </div>
            </ScrollFade>

            <TemplateDetailFooter template={template} onImported={onImported} />
        </div>
    )
}
