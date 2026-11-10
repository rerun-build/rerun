'use client'

import { useReducedMotion } from 'motion/react'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, type RefObject } from 'react'
import { ChromeButton } from '@rerun/ui/chrome'

import { Kbd } from '@/components/ui/kbd'
import { MicIcon, SendIcon } from '@/lib/icons'

import { useTypewriter } from './useTypewriter'

const KEY = 'min-w-5 gap-1 px-1 py-0 text-[10px] font-normal text-muted-foreground shadow-none'

// The pill grows by a CSS transition: once it has run, the field is wider than the caret last saw
// it, so the end of the line is brought back.
const GROW_MS = 220

function revealCaret(input: HTMLInputElement) {
    const end = input.value.length
    if (input.selectionStart === end) input.scrollLeft = input.scrollWidth
}

type ForemanPillFieldProps = {
    inputRef: RefObject<HTMLInputElement | null>
    mod: string
    draft: string
    focused: boolean
    onDraftChange: (draft: string) => void
    /** Has to be stable: it is also called when the field goes away. */
    onFocusChange: (focused: boolean) => void
    onEngage: () => void
    onSubmit: () => void
}

/** What is typed here is sent from here and answered above the ball. Only the ball opens the column. */
export function ForemanPillField({ inputRef, mod, draft, focused, onDraftChange, onFocusChange, onEngage, onSubmit }: ForemanPillFieldProps) {
    const t = useTranslations('foreman.pill')
    const reducedMotion = useReducedMotion()
    const prompts = useMemo(() => [t('prompts.lastNight'), t('prompts.failedRun'), t('prompts.newCoworker')], [t])
    const suggestion = useTypewriter(prompts, { paused: !!reducedMotion || focused })
    const writing = focused || draft.length > 0

    useEffect(() => {
        const input = inputRef.current
        if (!writing || !input) return
        const timer = setTimeout(() => revealCaret(input), GROW_MS)
        return () => clearTimeout(timer)
    }, [writing, inputRef])

    // A field replaced while it held the caret never blurs: the pill would stay wide for nobody.
    useEffect(() => () => onFocusChange(false), [onFocusChange])

    return (
        <form
            className="contents"
            onSubmit={event => {
                event.preventDefault()
                onSubmit()
            }}
        >
            <label className="flex h-full min-w-0 flex-1 cursor-text items-center gap-1.5">
                <input
                    ref={inputRef}
                    value={draft}
                    onChange={event => onDraftChange(event.target.value)}
                    onFocus={event => {
                        const input = event.currentTarget
                        input.setSelectionRange(input.value.length, input.value.length)
                        revealCaret(input)
                        onFocusChange(true)
                        onEngage()
                    }}
                    onBlur={() => onFocusChange(false)}
                    onKeyDown={event => {
                        if (event.key === 'Escape') event.currentTarget.blur()
                    }}
                    placeholder={suggestion}
                    aria-label={t('ask')}
                    autoComplete="off"
                    className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                />
                {!writing && (
                    <span aria-hidden className="flex shrink-0 items-center gap-1 pr-1">
                        <Kbd className={KEY}>{mod}K</Kbd>
                        <Kbd className={KEY}>
                            <MicIcon className="size-2.5" />
                            Space
                        </Kbd>
                    </span>
                )}
            </label>
            {draft.trim() && <ChromeButton type="submit" icon={SendIcon} aria-label={t('send')} />}
        </form>
    )
}
