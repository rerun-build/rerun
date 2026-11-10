'use client'

import type { ReactNode } from 'react'

import { cn } from '../cn'
import { useKitTranslations } from '../locale'
import { ScrollFade } from '../primitives/scroll-fade'

import { Caret } from './marks'

// Under 16px, iOS zooms the page in when the field takes the focus.
const TYPE = 'px-1 text-base leading-relaxed whitespace-pre-wrap break-words sm:text-[15px]'

// The description, typed for real. A textarea cannot underline a few of its words, so it is laid,
// transparent, over a mirror that draws the same text with its marks: `mark` underlines, dotted, the
// words something was read from. Both wrap the same, so the caret falls where the mirror's words are.
// `drawnCaret` is for captures, where a textarea shows no caret; live, the textarea's own blinks.
// `preview` is a job shown in place of the text without replacing it: only the mirror draws it.
//
// Enter creates the agent, the way it sends a message everywhere else in the app; Shift+Enter breaks
// the line.
export function JobField({ text, onText, onSubmit, mark, preview, drawnCaret, placeholder, maxLength, className }: { text: string; onText: (text: string) => void; onSubmit: () => void; mark?: string | null; preview?: string | null; drawnCaret: boolean; placeholder?: ReactNode; maxLength?: number; className?: string }) {
    const t = useKitTranslations()
    return (
        <ScrollFade className="max-h-[min(12rem,30dvh)] overscroll-contain">
            {/* The scroll lives outside: inside it, the textarea stays as tall as the mirror and both scroll as one. */}
            <div className={cn('relative', className)}>
                <p aria-hidden className={cn(TYPE, 'pointer-events-none')}>
                    {preview ? <span className="text-muted-foreground/70">{preview}</span> : <Mirror text={text} mark={mark} caret={drawnCaret} placeholder={placeholder ?? t('newAgent.job.placeholder')} />}
                </p>
                <textarea
                    value={text}
                    onChange={event => onText(event.target.value)}
                    onKeyDown={event => {
                        if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
                        event.preventDefault()
                        onSubmit()
                    }}
                    aria-label={t('newAgent.job.label')}
                    spellCheck={false}
                    maxLength={maxLength}
                    className={cn(TYPE, 'absolute inset-0 size-full resize-none overflow-hidden bg-transparent text-transparent outline-none selection:bg-foreground/20', drawnCaret || preview ? 'caret-transparent' : 'caret-foreground')}
                />
            </div>
        </ScrollFade>
    )
}

function Mirror({ text, mark, caret, placeholder }: { text: string; mark?: string | null; caret: boolean; placeholder: ReactNode }) {
    if (!text) {
        return (
            <span className="text-muted-foreground/70">
                {caret && <Caret className="mr-px" />}
                {placeholder}
            </span>
        )
    }
    const at = mark ? text.indexOf(mark) : -1
    return (
        <>
            {at < 0 || !mark ? (
                text
            ) : (
                <>
                    {text.slice(0, at)}
                    <span className="underline decoration-foreground/35 decoration-dotted decoration-[1.5px] underline-offset-[5px]">{mark}</span>
                    {text.slice(at + mark.length)}
                </>
            )}
            {/* A line break typed last has no height of its own in the mirror, which would leave the
                caret one line below the text it belongs to. */}
            {text.endsWith('\n') && '\u200b'}
            {caret && <Caret className="ml-px" />}
        </>
    )
}
