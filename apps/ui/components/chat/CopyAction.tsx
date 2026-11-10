'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { MessageAction } from '@/components/ai-elements/message'
import { CheckIcon, CopyIcon } from '@/lib/icons'

export function CopyAction({ text, tooltip }: { text: string; tooltip?: string }) {
    const t = useTranslations('chat.actions')
    const [copied, setCopied] = useState(false)
    return (
        <MessageAction
            tooltip={copied ? t('copiedExclaim') : (tooltip ?? t('copy'))}
            onClick={() => {
                navigator.clipboard.writeText(text).then(() => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                })
            }}
        >
            {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
        </MessageAction>
    )
}
