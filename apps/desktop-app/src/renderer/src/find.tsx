import { Button } from '@rerun/ui/primitives'
import { ChevronDownIcon, ChevronUpIcon, XIcon } from '@rerun/cloud/ui-icons'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslations } from 'use-intl'
import type { FindResult } from '../../shared/ipc-channels'
import { mount } from './mount'
import { shellLocal } from './shell-local'

function FindBar() {
    const t = useTranslations('desktopApp.find')
    const input = useRef<HTMLInputElement>(null)
    const [text, setText] = useState('')
    const [result, setResult] = useState<FindResult>({ active: 0, total: 0 })

    useEffect(() => {
        const local = shellLocal()
        if (!local) return
        const offResult = local.onFindResult(setResult)
        const offFocus = local.onFindFocus(() => input.current?.select())
        input.current?.focus()
        return () => {
            offResult()
            offFocus()
        }
    }, [])

    const search = (value: string, forward = true, findNext = false) => shellLocal()?.find({ text: value, forward, findNext })

    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Escape') {
            event.preventDefault()
            shellLocal()?.closeFind()
        }
        if (event.key === 'Enter') {
            event.preventDefault()
            search(text, !event.shiftKey, true)
        }
    }

    const counter = text ? (result.total > 0 ? t('matches', { active: result.active, total: result.total }) : t('noMatches')) : ''

    return (
        <div className="flex h-full items-center p-1">
            <div className="flex h-11 w-full items-center gap-1 rounded-xl border bg-popover pl-3 pr-1 text-popover-foreground shadow-lg">
                <input
                    ref={input}
                    value={text}
                    onChange={(event) => {
                        setText(event.target.value)
                        search(event.target.value)
                    }}
                    onKeyDown={onKeyDown}
                    placeholder={t('placeholder')}
                    aria-label={t('placeholder')}
                    spellCheck={false}
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
                <span className="shrink-0 px-1 text-xs tabular-nums text-muted-foreground" aria-live="polite">
                    {counter}
                </span>
                <Button variant="ghost" size="icon-sm" aria-label={t('previous')} disabled={result.total === 0} onClick={() => search(text, false, true)}>
                    <ChevronUpIcon />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label={t('next')} disabled={result.total === 0} onClick={() => search(text, true, true)}>
                    <ChevronDownIcon />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label={t('close')} onClick={() => shellLocal()?.closeFind()}>
                    <XIcon />
                </Button>
            </div>
        </div>
    )
}

document.documentElement.style.background = 'transparent'
document.body.style.background = 'transparent'
mount(<FindBar />)
