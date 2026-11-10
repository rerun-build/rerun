'use client'

import { Button } from '@/components/ui/button'
import { CheckIcon, CopyIcon } from '@/lib/icons'
import { useCopy } from '@/lib/use-copy'
import { useTranslations } from 'next-intl'
import type { CustomRendererProps } from 'streamdown'

export const DRAFT_LANGUAGE = 'draft'

/**
 * A ```draft fence: a text the user sends or pastes elsewhere (an email, a post, a message). It
 * reads as prose rather than code, and copies exactly as written. The fence's meta names it.
 */
export function DraftBlock({ code, meta, isIncomplete }: CustomRendererProps) {
    const t = useTranslations('chat')
    const { copied, copy } = useCopy()
    const text = code.replace(/\n+$/, '')

    return (
        <div data-streamdown="code-block" data-language={DRAFT_LANGUAGE} data-incomplete={isIncomplete || undefined} className="my-4 flex w-full flex-col gap-2 rounded-xl border border-border bg-sidebar p-2">
            <div data-streamdown="code-block-header" className="flex h-8 items-center justify-between gap-2 text-muted-foreground text-xs">
                <span className="ml-1 truncate">{meta?.trim() || t('draft.label')}</span>
                <Button size="xs" variant="ghost" disabled={isIncomplete} onClick={() => copy(text)} className="text-muted-foreground">
                    {copied ? <CheckIcon className="text-emerald-500" /> : <CopyIcon />}
                    {copied ? t('actions.copied') : t('actions.copy')}
                </Button>
            </div>
            <div data-streamdown="code-block-body" className="rounded-md border border-border bg-background p-4 text-sm leading-relaxed whitespace-pre-wrap wrap-anywhere">
                {text}
            </div>
        </div>
    )
}
