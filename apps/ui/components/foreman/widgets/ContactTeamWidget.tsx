'use client'

import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { PANEL_CARD } from '@/components/ui/panel-row'
import { realEmail } from '@/lib/auth/placeholder-email'
import { openCrisp, sendToCrisp } from '@/lib/crisp'
import { CircleCheckIcon, LifeBuoyIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { useSession } from '@/supabase/session/SessionProvider'
import { ForemanOutcomeRow } from './ForemanOutcomeRow'

// The foreman handing a stuck user to a person. Nothing leaves before they click: the click sends
// the foreman's summary into the support chat under their account, and opens it.

export type ContactTeamResult = { sent: true } | { answered: false }

type ContactTeamWidgetProps = {
    input: unknown
    output?: unknown
    onAnswer: (result: ContactTeamResult) => void
}

function readSummary(input: unknown): string | null {
    const summary = input && typeof input === 'object' ? (input as { summary?: unknown }).summary : undefined
    return typeof summary === 'string' && summary.trim() ? summary.trim() : null
}

export function ContactTeamWidget({ input, output, onAnswer }: ContactTeamWidgetProps) {
    const t = useTranslations('foreman.contact')
    const { session, workspace } = useSession()
    const email = session?.user?.email
    const replyAddress = realEmail(email)
    const summary = readSummary(input) ?? t('defaultSummary')
    const send = () => sendToCrisp({ email, workspaceId: workspace?.id, text: summary })

    if ((output as { sent?: unknown } | undefined)?.sent === true) {
        return (
            <ForemanOutcomeRow
                className="mb-2"
                icon={CircleCheckIcon}
                tone="text-emerald-500"
                text={replyAddress ? t('sentWithEmail', { email: replyAddress }) : t('sent')}
                action={
                    <Button variant="ghost" size="sm" onClick={() => openCrisp(email)}>
                        {t('openChat')}
                    </Button>
                }
            />
        )
    }

    // Typed over: the tool is closed and cannot take a second answer, but the way to a person stays.
    if (output) {
        return (
            <ForemanOutcomeRow
                className="mb-2"
                icon={LifeBuoyIcon}
                text={t('stillStuck')}
                action={
                    <Button variant="secondary" size="sm" onClick={send}>
                        {t('send')}
                    </Button>
                }
            />
        )
    }

    return (
        <div className={cn('mb-2 flex flex-col gap-3 p-4', PANEL_CARD)}>
            <div className="flex flex-col gap-0.5">
                <p className="text-sm font-medium">{t('title')}</p>
                <p className="text-xs text-muted-foreground">{t('description')}</p>
            </div>
            <blockquote className="border-l-2 border-border pl-3 text-sm text-muted-foreground">{summary}</blockquote>
            <div className="flex items-center justify-end gap-2">
                <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => onAnswer({ answered: false })}>
                    {t('notNow')}
                </Button>
                <Button
                    size="sm"
                    onClick={() => {
                        send()
                        onAnswer({ sent: true })
                    }}
                >
                    {t('send')}
                </Button>
            </div>
        </div>
    )
}
