'use client'

import type { Brand } from '@rerun/contracts'
import { useTheme } from 'next-themes'
import { useSyncExternalStore } from 'react'

import type { PreviewSurface, PreviewTheme } from '@/ee/lib/organizations/console-routes'
import { APP_URL } from '@/lib/app-url'

import { Browser } from './Browser'
import { PreviewFrame } from './PreviewFrame'

export const addressOf = ({ appUrl }: Brand) => new URL(appUrl ?? APP_URL).host

const subscribe = () => () => {}

// The theme the page is read in, unknown on the server.
function usePageTheme(): PreviewTheme | null {
    const { resolvedTheme } = useTheme()
    const mounted = useSyncExternalStore(subscribe, () => true, () => false)
    if (!mounted) return null
    return resolvedTheme === 'dark' ? 'dark' : 'light'
}

export function BrandScreenPreview({ surface, brand, address = addressOf(brand), width = 1180, className, frameClassName }: { surface: PreviewSurface; brand: Brand; address?: string; width?: number; className?: string; frameClassName: string }) {
    const theme = usePageTheme()
    return (
        <Browser address={address} className={className}>
            {theme ? <PreviewFrame surface={surface} theme={theme} brand={brand} width={width} className={frameClassName} /> : <div className={frameClassName} />}
        </Browser>
    )
}
