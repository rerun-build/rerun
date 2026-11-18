'use client'

import type { ComputerAccessDecision, ComputerAccessRequest } from '@rerun/contracts'
import { BorderBeam } from '@rerun/ui'
import { Icon, ScrollFade } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import { useRef, useState } from 'react'

import { ComputerHandle } from '@/components/computers/ComputerBits'
import { Button } from '@/components/ui/button'
import { MousePointer2Icon, ShieldAlertIcon } from '@/lib/icons'

// What "Always allow" would keep, when the card offers it: a program, a folder, or the screen for
// the conversation. `warning` says what keeping it gives away (an interpreter runs any code).
export type ComputerAccessAlways = { rule: string; label: string; warning?: string }

type ComputerAccessCardProps = {
    request: ComputerAccessRequest
    always?: ComputerAccessAlways | null
    warning?: string
    onSubmit: (decision: Omit<ComputerAccessDecision, 'computer'>) => void
}

// The card of `request_computer_access`, in the family of the approval block: the same orange beam
// and shield, each command in a code block, Deny and Allow.
export function ComputerAccessCard({ request, always, warning, onSubmit }: ComputerAccessCardProps) {
    const t = useTranslations('chat.computerAccess')
    const [submitted, setSubmitted] = useState(false)
    // Answering twice starts two runs on the same conversation: the latch has to be a ref.
    const submittedRef = useRef(false)
    const screen = request.screen && request.commands.length === 0 && request.paths.length === 0
    const lines = request.commands.length > 0 ? request.commands : request.paths
    const title = screen ? 'titleScreen' : request.commands.length > 1 ? 'titleCommands' : request.commands.length === 1 ? 'titleCommand' : 'titleFiles'

    const decide = (decision: Omit<ComputerAccessDecision, 'computer'>) => {
        if (submittedRef.current) return
        submittedRef.current = true
        setSubmitted(true)
        onSubmit(decision)
    }

    return (
        <div className="@container relative space-y-2.5 overflow-hidden rounded-lg px-4 pt-3 pb-4" data-hitl="computer">
            <BorderBeam animated pattern="arcs" tone="orange" glow width={1} duration={7} />
            <div className="flex items-center gap-2.5 text-sm">
                <Icon size="sm" tone="orange" icon={screen ? MousePointer2Icon : ShieldAlertIcon} className="bg-orange-500/10 text-foreground" />
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                    {t.rich(title, { count: lines.length, computer: () => <ComputerHandle handle={request.computer} /> })}
                </span>
            </div>
            {request.reason && <p className="text-sm text-foreground">{request.reason}</p>}
            {request.cwd && request.commands.length > 0 && <p className="font-mono text-xs break-all text-muted-foreground">{t('inFolder', { folder: request.cwd })}</p>}
            {lines.length > 0 && (
                <ScrollFade className="max-h-[22vh] rounded bg-background">
                    <div className="divide-y divide-border/60">
                        {lines.map((command, index) => (
                            <code key={index} className="block px-2 py-1.5 font-mono text-xs break-all whitespace-pre-wrap text-foreground">
                                {command}
                            </code>
                        ))}
                    </div>
                </ScrollFade>
            )}
            {(warning ?? always?.warning) && <p className="text-xs text-orange-700 dark:text-orange-300">{warning ?? always?.warning}</p>}
            <div className="flex flex-wrap items-center justify-end gap-2">
                <Button size="sm" variant="destructive" disabled={submitted} onClick={() => decide({ decision: 'declined' })} data-hitl="decline">
                    {t('deny')}
                </Button>
                {always && (
                    <Button size="sm" variant="outline" disabled={submitted} onClick={() => decide({ decision: 'approved', always: always.rule })}>
                        {always.label}
                    </Button>
                )}
                <Button size="sm" disabled={submitted} onClick={() => decide({ decision: 'approved' })} data-hitl="approve">
                    {t('allow')}
                </Button>
            </div>
        </div>
    )
}
