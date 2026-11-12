'use client'

import { Button } from '@/components/ui/button'
import { desktopShell } from '@/lib/desktop-shell/client'
import { handOverQuickAsk, QUICK_ASK_MAX_LENGTH } from '@/lib/desktop-shell/quick-ask'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

// One field for the Chief of Staff, over whatever the person is doing. Enter sends: the text is handed
// to the main window, which opens a new conversation with it; Escape puts the window away.
export function QuickAskComposer() {
    const t = useTranslations('desktopShell.quickAsk')
    const field = useRef<HTMLTextAreaElement>(null)
    const [text, setText] = useState('')

    useEffect(() => {
        const focus = () => field.current?.focus()
        focus()
        window.addEventListener('focus', focus)
        return () => window.removeEventListener('focus', focus)
    }, [])

    const send = () => {
        const message = text.trim()
        const shell = desktopShell('quickAsk')
        if (!message || !shell) return
        handOverQuickAsk(message)
        setText('')
        shell.quickAsk.sent('/')
    }

    const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Escape') {
            event.preventDefault()
            desktopShell('quickAsk')?.quickAsk.close()
        }
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            send()
        }
    }

    return (
        <main data-quick-ask className="flex h-dvh w-full items-stretch p-2">
            <div className="flex w-full flex-col gap-2 rounded-2xl border bg-popover p-3 text-popover-foreground shadow-2xl">
                <textarea
                    ref={field}
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    onKeyDown={onKeyDown}
                    maxLength={QUICK_ASK_MAX_LENGTH}
                    placeholder={t('placeholder')}
                    aria-label={t('placeholder')}
                    className="min-h-0 flex-1 resize-none bg-transparent text-base outline-none placeholder:text-muted-foreground"
                />
                <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-muted-foreground">{t('hint')}</span>
                    <Button size="sm" onClick={send} disabled={!text.trim()}>
                        {t('send')}
                    </Button>
                </div>
            </div>
        </main>
    )
}
