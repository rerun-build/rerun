'use client'

import { useTranslations } from 'next-intl'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ChevronDownIcon, WorkflowIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { Markdown } from '@rerun/ui/markdown'
import { Stripes } from '@rerun/ui/primitives'
// Nucleo glyph with no lucide counterpart, so no name to add to the `@/lib/icons` shim.

const HINT_CLASS_NAME = 'text-xs text-muted-foreground/80 [&_p]:leading-snug [&_code]:py-0 [&_code]:text-[0.8em]'

// Ordered list items become numbered pips through a CSS counter, so the author writes plain `1.`.
const STEPS_CLASS_NAME = cn(
    '[&_ol]:mt-0 [&_ol]:list-none [&_ol]:space-y-3 [&_ol]:pl-0 [&_ol]:[counter-reset:step]',
    '[&_li]:relative [&_li]:mt-0 [&_li]:pl-8 [&_li]:text-sm [&_li]:leading-6 [&_li]:[counter-increment:step]',
    '[&_li]:before:absolute [&_li]:before:top-0.5 [&_li]:before:left-0 [&_li]:before:flex [&_li]:before:size-5 [&_li]:before:items-center [&_li]:before:justify-center',
    '[&_li]:before:rounded-full [&_li]:before:bg-foreground/10 [&_li]:before:text-[11px] [&_li]:before:font-medium [&_li]:before:text-foreground',
    '[&_li]:before:content-[counter(step)]',
)

// Most labels open on a brand ("Stripe secret key") or an acronym ("API key") and keep their case;
// only a leading common word is lowered, so "Secret key" reads as "secret key" mid-sentence.
const COMMON_LEADING_WORDS = new Set(['access', 'account', 'admin', 'authorization', 'bot', 'client', 'personal', 'private', 'public', 'secret', 'service', 'user'])

function inSentence(label: string): string {
    const firstWord = label.split(' ')[0]
    return COMMON_LEADING_WORDS.has(firstWord.toLowerCase()) ? label.charAt(0).toLowerCase() + label.slice(1) : label
}

export function CredentialHint({ help }: { help: string }) {
    return <Markdown content={help} className={HINT_CLASS_NAME} />
}

export function CredentialGuide({ label, title, guide }: { label: string; title?: string; guide: string }) {
    const t = useTranslations('services.credentialGuide')
    return (
        <Collapsible className="mt-2 rounded-md border border-border bg-background/60">
            <CollapsibleTrigger className="group relative flex w-full items-center justify-between overflow-hidden rounded-md px-3 py-2 data-[state=open]:rounded-b-none text-xs font-medium text-foreground/80 hover:text-foreground">
                <Stripes fade="bottom" band={6} period={13} />
                <span className="relative inline-flex items-center gap-1.5">
                    <WorkflowIcon className="size-3.5" />
                    {title ?? t('title', { label: inSentence(label) })}
                </span>
                <ChevronDownIcon className="relative size-3.5 transition-transform group-data-[state=open]:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent className="border-t border-border px-3 py-3">
                <Markdown content={guide} className={STEPS_CLASS_NAME} />
            </CollapsibleContent>
        </Collapsible>
    )
}
