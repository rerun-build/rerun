'use client'

import type { RefObject } from 'react'
import { useTranslations } from 'next-intl'

import { CheckIcon, CopyIcon } from '@/lib/icons'
import { useCopy } from '@/lib/use-copy'

// A <button> is laid out as an inline-block and drops to its own line once the value is long: the
// chip stays an inline span so it wraps with the sentence, its background cloned on each line. The
// last character rides in a nowrap span with the icon, so the icon never starts a line alone.
// `pasteTarget` is the field the value is pasted into: it takes the focus once copied, so the next
// keystroke is the paste.
export function CopyChip({ value, pasteTarget }: { value: string; pasteTarget?: RefObject<HTMLInputElement | null> }) {
    const t = useTranslations('dialogs.copy')
    const { copied, copy } = useCopy()
    const characters = Array.from(value)
    const lastCharacter = characters.pop()

    const copyValue = () => {
        copy(value)
        pasteTarget?.current?.focus()
        pasteTarget?.current?.select()
    }

    return (
        <span
            role="button"
            tabIndex={0}
            aria-label={t('snippet', { label: value })}
            onClick={copyValue}
            onKeyDown={event => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                copyValue()
            }}
            className="mx-0.5 cursor-pointer rounded-md bg-muted px-2 py-0.5 font-medium text-foreground break-words box-decoration-clone transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
            {characters.join('')}
            <span className="whitespace-nowrap">
                {lastCharacter}
                <span className="ms-1.5 inline-block align-[-0.15em]">
                    {copied ? <CheckIcon className="size-3.5 shrink-0 text-emerald-500" /> : <CopyIcon className="size-3.5 shrink-0 text-muted-foreground" />}
                </span>
            </span>
        </span>
    )
}
