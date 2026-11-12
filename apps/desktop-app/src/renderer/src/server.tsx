import { Field, Input } from '@rerun/ui/forms'
import { Button } from '@rerun/ui/primitives'
import { useEffect, useState, type FormEvent } from 'react'
import { useTranslations } from 'use-intl'
import type { ServerInfo } from '../../shared/ipc-channels'
import { mount } from './mount'
import { ShellFrame } from './ShellFrame'
import { shellLocal } from './shell-local'

type ErrorKey = 'invalid' | 'unreachable' | 'notRerun' | 'tooOld'

function looksInsecure(address: string): boolean {
    const match = address.trim().match(/^http:\/\/([^/:]+)/i)
    if (!match) return false
    const host = match[1].toLowerCase()
    return !(host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost'))
}

function ServerPage() {
    const t = useTranslations('desktopApp.server')
    const params = new URLSearchParams(location.search)
    const [info, setInfo] = useState<ServerInfo | null>(null)
    const [address, setAddress] = useState('')
    const [error, setError] = useState<{ key: ErrorKey; version?: string } | null>(() => {
        const initial = params.get('error') as ErrorKey | null
        return initial ? { key: initial, version: params.get('version') ?? undefined } : null
    })
    const [connecting, setConnecting] = useState(false)

    useEffect(() => {
        void shellLocal()
            ?.serverInfo()
            .then((value) => {
                setInfo(value)
                if (value.current) setAddress(value.current)
            })
    }, [])

    const connect = async (target: string) => {
        setConnecting(true)
        setError(null)
        const result = await shellLocal()?.connect(target)
        if (result && !result.ok) {
            setError({ key: result.reason, version: result.version })
            setConnecting(false)
        }
    }

    const onSubmit = (event: FormEvent) => {
        event.preventDefault()
        if (address.trim()) void connect(address)
    }

    const message = error ? (error.key === 'tooOld' ? t('tooOld', { version: error.version ?? '' }) : t(error.key)) : looksInsecure(address) ? t('insecure') : undefined

    return (
        <ShellFrame>
            <div className="flex flex-col gap-2">
                <h1 className="text-lg font-semibold text-balance">{t('title')}</h1>
                <p className="text-sm text-muted-foreground text-balance">{t('description')}</p>
            </div>
            <form onSubmit={onSubmit} className="flex w-full flex-col gap-4 text-left">
                <Field label={t('label')} htmlFor="server-address" error={error ? message : undefined} helperText={!error ? message : undefined}>
                    <Input
                        id="server-address"
                        value={address}
                        onChange={(event) => {
                            setAddress(event.target.value)
                            setError(null)
                        }}
                        placeholder="rerun.example.com"
                        autoFocus
                        autoComplete="url"
                        spellCheck={false}
                        aria-invalid={!!error}
                        className="select-text"
                    />
                </Field>
                <Button type="submit" loading={connecting} disabled={!address.trim()}>
                    {t('connect')}
                </Button>
                {info?.defaultServer && info.defaultServer !== info.current && (
                    <Button type="button" variant="ghost" disabled={connecting} onClick={() => void connect(info.defaultServer!)}>
                        {t('useRerunCloud')}
                    </Button>
                )}
                {info?.canCancel && (
                    <Button type="button" variant="ghost" disabled={connecting} onClick={() => shellLocal()?.cancelServerChange()}>
                        {t('cancel')}
                    </Button>
                )}
            </form>
        </ShellFrame>
    )
}

mount(<ServerPage />)
