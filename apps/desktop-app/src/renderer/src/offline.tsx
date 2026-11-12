import { Button } from '@rerun/ui/primitives'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'use-intl'
import { mount } from './mount'
import { ShellFrame } from './ShellFrame'
import { shellLocal } from './shell-local'

const RETRY_EVERY_MS = 5000
const DOWNLOAD_URL = 'https://rerun.build/download'

type Reason = 'offline' | 'unavailable' | 'incompatible'

function OfflinePage() {
    const t = useTranslations('desktopApp')
    const params = new URLSearchParams(location.search)
    const host = params.get('host') ?? ''
    const reason = (params.get('reason') ?? 'offline') as Reason
    const [retrying, setRetrying] = useState(false)
    const inFlight = useRef(false)

    // The background attempts stay silent; only the button shows that it is trying.
    const retry = useCallback(async (shown: boolean) => {
        if (inFlight.current) return
        inFlight.current = true
        if (shown) setRetrying(true)
        try {
            await shellLocal()?.retry()
        } finally {
            inFlight.current = false
            setRetrying(false)
        }
    }, [])

    useEffect(() => {
        if (reason === 'incompatible') return
        const timer = setInterval(() => void retry(false), RETRY_EVERY_MS)
        const onOnline = () => void retry(false)
        window.addEventListener('online', onOnline)
        return () => {
            clearInterval(timer)
            window.removeEventListener('online', onOnline)
        }
    }, [reason, retry])

    if (reason === 'incompatible') {
        return (
            <ShellFrame>
                <div className="flex flex-col gap-2">
                    <h1 className="text-lg font-semibold text-balance">{t('incompatible.title')}</h1>
                    <p className="text-sm text-muted-foreground text-balance">{t('incompatible.body', { host })}</p>
                </div>
                <Button asChild>
                    <a href={DOWNLOAD_URL} target="_blank" rel="noreferrer">
                        {t('incompatible.download')}
                    </a>
                </Button>
            </ShellFrame>
        )
    }

    return (
        <ShellFrame>
            <div className="flex flex-col gap-2">
                <h1 className="text-lg font-semibold text-balance">{t('offline.title')}</h1>
                <p className="text-sm text-muted-foreground text-balance">{reason === 'unavailable' ? t('offline.unavailable', { host }) : t('offline.body', { host })}</p>
            </div>
            <Button onClick={() => void retry(true)} loading={retrying}>
                {t('offline.retry')}
            </Button>
        </ShellFrame>
    )
}

mount(<OfflinePage />)
