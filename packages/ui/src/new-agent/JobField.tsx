'use client'

import type { ReactNode } from 'react'

import { cn } from '../cn'
import { useKitTranslations } from '../locale'
import { ScrollFade } from '../primitives/scroll-fade'

import { Caret } from './marks'

const TYPE = 'px-1 text-base leading-relaxed whitespace-pre-wrap break-words sm:text-[15px]'

export function JobField({ text, onText, onSubmit, mark, preview, drawnCaret, placeholder, maxLength, className }: { text: string; onText: (text: string) => void; onSubmit: () => void; mark?: string | null; preview?: string | null; drawnCaret: boolean; placeholder?: ReactNode; maxLength?: number; className?: string }) {
    const t = useKitTranslations()
    return (
        <ScrollFade className="max-h-[min(12rem,30dvh)] overscroll-contain">
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
            {text.endsWith('\n') && '\u200b'}
            {caret && <Caret className="ml-px" />}
        </>
    )
}
