'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type KitBackdrop = 'card' | 'plain' | 'checker'

export const KIT_BACKDROPS: { value: KitBackdrop; label: string }[] = [
    { value: 'card', label: 'Card' },
    { value: 'plain', label: 'Plain' },
    { value: 'checker', label: 'Checker' },
]

export const KIT_SCALES = [0.5, 0.75, 1, 1.5, 2, 3, 4]

type KitControlsValue = {
    backdrop: KitBackdrop
    setBackdrop: (value: KitBackdrop) => void
    scale: number
    setScale: (value: number) => void
    solo: string | null
    setSolo: (id: string | null) => void
}

const KitControlsContext = createContext<KitControlsValue | null>(null)

export function useKitControls() {
    const value = useContext(KitControlsContext)
    if (!value) throw new Error('useKitControls must be used inside KitControlsProvider')
    return value
}

function writeParams(entries: Record<string, string | null>) {
    const url = new URL(window.location.href)
    for (const [key, value] of Object.entries(entries)) {
        if (value === null) url.searchParams.delete(key)
        else url.searchParams.set(key, value)
    }
    window.history.replaceState(null, '', url)
}

export function KitControlsProvider({ children }: { children: ReactNode }) {
    const [backdrop, setBackdropState] = useState<KitBackdrop>('card')
    const [scale, setScaleState] = useState(1)
    const [solo, setSoloState] = useState<string | null>(null)

    useEffect(() => {
        const params = new URLSearchParams(window.location.search)
        setSoloState(params.get('solo'))
        const requested = params.get('backdrop')
        if (requested === 'card' || requested === 'plain' || requested === 'checker') setBackdropState(requested)
        const zoom = Number(params.get('scale'))
        if (Number.isFinite(zoom) && zoom > 0) setScaleState(zoom)
    }, [])

    const setBackdrop = useCallback((value: KitBackdrop) => {
        setBackdropState(value)
        writeParams({ backdrop: value === 'card' ? null : value })
    }, [])

    const setScale = useCallback((value: number) => {
        setScaleState(value)
        writeParams({ scale: value === 1 ? null : String(value) })
    }, [])

    const setSolo = useCallback((id: string | null) => {
        setSoloState(id)
        writeParams({ solo: id })
    }, [])

    const value = useMemo(
        () => ({ backdrop, setBackdrop, scale, setScale, solo, setSolo }),
        [backdrop, setBackdrop, scale, setScale, solo, setSolo],
    )

    return <KitControlsContext.Provider value={value}>{children}</KitControlsContext.Provider>
}
