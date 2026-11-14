'use client'

import { PromptInputButton } from '@/components/ai-elements/prompt-input'
import { Spinner } from '@/components/ui/spinner'
import type { VoiceMessageStatus } from '@/hooks/useVoiceMessage'
import { MicIcon, RefreshCcwIcon, SendIcon, XIcon } from '@/lib/icons'
import { useTranslations } from 'next-intl'

type VoiceComposerControlsProps = {
    status: VoiceMessageStatus
    besideSend?: boolean
    onStart: () => void
    onFinish: () => void
    onRetry: () => void
    onDiscard: () => void
}

export function VoiceComposerControls({ status, besideSend = false, onStart, onFinish, onRetry, onDiscard }: VoiceComposerControlsProps) {
    const t = useTranslations('chat.voice')
    if (status === 'idle') {
        return (
            <PromptInputButton variant={besideSend ? 'ghost' : 'default'} tooltip={t('record')} aria-label={t('record')} onClick={onStart}>
                <MicIcon className="size-4" />
            </PromptInputButton>
        )
    }

    const busy = status === 'starting' || status === 'processing'

    return (
        <>
            <PromptInputButton tooltip={t('discard')} aria-label={t('discardLabel')} onClick={onDiscard} disabled={status === 'processing'}>
                <XIcon className="size-4" />
            </PromptInputButton>
            <PromptInputButton
                variant="default"
                tooltip={status === 'failed' ? t('retry') : t('send')}
                aria-label={status === 'failed' ? t('retryLabel') : t('sendLabel')}
                onClick={status === 'failed' ? onRetry : onFinish}
                disabled={busy}
            >
                {busy ? <Spinner /> : status === 'failed' ? <RefreshCcwIcon className="size-4" /> : <SendIcon className="size-4" />}
            </PromptInputButton>
        </>
    )
}
