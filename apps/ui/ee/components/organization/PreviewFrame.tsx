'use client'

import type { Brand } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'

import { consolePreviewPath, type PreviewSurface, type PreviewTheme } from '@/ee/lib/organizations/console-routes'

import { ScaledFrame } from './Browser'
import { draftMessage, isPreviewReady } from './preview-message'

// A screen of the product in a frame of its own, which wears the brand it is handed, saved or not.
export function PreviewFrame({ surface, theme, brand, width, className }: { surface: PreviewSurface; theme: PreviewTheme; brand: Brand; width: number; className?: string }) {
    const t = useTranslations('organization.preview')
    const [frame, setFrame] = useState<HTMLIFrameElement | null>(null)
    const { name, iconUrl, color, supportEmail } = brand

    const send = useCallback(() => frame?.contentWindow?.postMessage(draftMessage({ name, iconUrl, color, supportEmail }), window.location.origin), [frame, name, iconUrl, color, supportEmail])

    useEffect(() => {
        send()
        const answer = (event: MessageEvent) => {
            if (event.origin === window.location.origin && event.source === frame?.contentWindow && isPreviewReady(event.data)) send()
        }
        window.addEventListener('message', answer)
        return () => window.removeEventListener('message', answer)
    }, [send, frame])

    return <ScaledFrame key={`${surface}-${theme}`} onFrame={setFrame} title={t(`titles.${surface}`)} src={consolePreviewPath(surface, theme)} width={width} className={className} />
}
