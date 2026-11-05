'use client'

import { useState } from 'react'

import { MessageAction } from '@/components/ai-elements/message'
import { CheckIcon, CopyIcon } from '@/lib/icons'

export function CopyAction({ text, tooltip = 'Copy' }: { text: string; tooltip?: string }) {
    const [copied, setCopied] = useState(false)
    return (
        <MessageAction
            tooltip={copied ? 'Copied!' : tooltip}
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
