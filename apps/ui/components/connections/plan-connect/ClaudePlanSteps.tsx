'use client'

import { useTranslations } from 'next-intl'
import { useRef, useState, type ClipboardEvent } from 'react'

import type { ClaudeOAuth } from '@/components/connections/use-claude-oauth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { ProviderIcon } from '@/lib/engine/provider-icons'
import { ClipboardPasteIcon } from '@/lib/icons'

import { ForemanTrack, type TrackStep } from './ForemanTrack'
import { StepError } from './step-bits'

export function ClaudePlanSteps({ oauth, lastStep }: { oauth: ClaudeOAuth; lastStep: (linked: boolean) => TrackStep }) {
    const t = useTranslations('connections.claude')
    const { phase } = oauth
    const opened = phase !== 'idle'
    const busy = phase === 'checking'
    const linked = phase === 'connected'
    const last = lastStep(linked)

    return (
        <ForemanTrack
            at={linked ? 2 : opened ? 1 : 0}
            done={linked ? 3 : opened ? 1 : 0}
            orb={busy ? 'thinking' : linked ? 'speaking' : 'listening'}
            remark={linked ? (last.remark ?? t('remarks.connected')) : t(`remarks.${phase}`)}
            thinking={busy}
            steps={[
                {
                    title: t('approveStep'),
                    body: (
                        <TooltipDisabledReason reason={oauth.opening ? t('opening') : undefined}>
                            <Button type="button" variant={opened ? 'outline' : 'default'} onClick={oauth.start} disabled={busy || linked || oauth.opening} className="gap-1.5">
                                <ProviderIcon provider="claude" className="size-3.5" />
                                {opened ? t('openAgain') : t('open')}
                            </Button>
                        </TooltipDisabledReason>
                    ),
                },
                { title: t('pasteStep'), body: <CodeInput oauth={oauth} /> },
                last,
            ]}
        />
    )
}

// The field takes the code Claude shows, or a `claude setup-token` token typed or pasted by hand.
// A code pasted straight in goes to the exchange at once; a token waits for Enter or a blur.
function CodeInput({ oauth }: { oauth: ClaudeOAuth }) {
    const t = useTranslations('connections.claude')
    const [value, setValue] = useState('')
    const [pasteRefused, setPasteRefused] = useState(false)
    const field = useRef<HTMLInputElement>(null)
    const busy = oauth.phase === 'checking'
    const linked = oauth.phase === 'connected'

    const submit = async (text: string) => {
        if (await oauth.submit(text)) setValue('')
    }

    const pasteIntoField = (event: ClipboardEvent<HTMLInputElement>) => {
        const text = event.clipboardData.getData('text').trim()
        if (!text || text.startsWith('sk-ant')) return
        event.preventDefault()
        void submit(text)
    }

    // The browser may ask for permission, or not offer the clipboard at all: the field is the way
    // back in.
    const pasteFromClipboard = async () => {
        const text = await navigator.clipboard?.readText?.().catch(() => '')
        setPasteRefused(!text?.trim())
        if (text?.trim()) return submit(text)
        field.current?.focus()
    }

    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex gap-2">
                <div className="min-w-0 flex-1">
                    <Input ref={field} hideRequired type="password" value={value} onChange={event => setValue(event.target.value)} onPaste={pasteIntoField} onKeyDown={event => event.key === 'Enter' && void submit(value)} onBlur={() => void submit(value)} disabled={busy || linked} placeholder={busy ? t('checkingCode') : linked ? t('codeAccepted') : t('codePlaceholder')} className="h-8 w-full font-mono text-xs" />
                </div>
                <Button type="button" variant={oauth.phase === 'waiting' ? 'default' : 'outline'} onMouseDown={event => event.preventDefault()} onClick={pasteFromClipboard} disabled={busy || linked} className="gap-1.5">
                    <ClipboardPasteIcon />
                    {t('paste')}
                </Button>
            </div>
            {pasteRefused && !oauth.error && <p className="text-[11px] text-muted-foreground">{t('pasteHint')}</p>}
            <StepError error={oauth.error} />
        </div>
    )
}
