'use client'

import type { Brand } from '@rerun/contracts'
import { useEffect, useState } from 'react'

import { BrandProvider } from '@/components/brand/BrandProvider'
import { BrandStyle } from '@/components/brand/BrandStyle'
import type { PreviewSurface, PreviewTheme } from '@/ee/lib/organizations/console-routes'

import { PREVIEW_READY, readDraftMessage, type BrandDraft } from '../preview-message'
import { AppPreview } from './AppPreview'
import { AuthPreview } from './AuthPreview'
import { useFrameTheme } from './useFrameTheme'

// `data-organization-preview`: none of what the app runs around its pages (see AppChrome).
export function PreviewScreen({ surface, theme, brand: saved }: { surface: PreviewSurface; theme: PreviewTheme; brand: Brand }) {
    useFrameTheme(theme)
    const [draft, setDraft] = useState<BrandDraft | null>(null)
    const brand = { ...saved, ...draft }

    useEffect(() => {
        const wear = (event: MessageEvent) => {
            if (event.origin !== window.location.origin || event.source !== window.parent) return
            const next = readDraftMessage(event.data)
            if (next) setDraft(next)
        }
        window.addEventListener('message', wear)
        if (window.parent !== window) window.parent.postMessage(PREVIEW_READY, window.location.origin)
        return () => window.removeEventListener('message', wear)
    }, [])

    return (
        <BrandProvider brand={brand}>
            <script dangerouslySetInnerHTML={{ __html: `document.documentElement.classList.remove('light','dark');document.documentElement.classList.add('${theme}')` }} />
            <BrandStyle brand={brand} />
            <div data-organization-preview="" className="h-dvh overflow-hidden">
                {surface === 'app' ? <AppPreview brand={brand} /> : <AuthPreview brand={brand} />}
            </div>
        </BrandProvider>
    )
}
