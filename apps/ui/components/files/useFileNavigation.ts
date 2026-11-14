'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type UseFileNavigationOptions<T> = {
    list: (path: string, showHidden: boolean) => Promise<T[]>
    initialPath?: string
    initialShowHidden?: boolean
    onDirectoryLoaded?: (path: string, entries: T[]) => void
}

export type FileNavigation<T> = {
    currentPath: string
    entries: T[]
    depth: number
    loading: boolean
    busy: boolean
    showHidden: boolean
    navigate: (path: string) => void
    enter: (name: string) => void
    goUp: () => void
    goHome: () => void
    setShowHidden: (update: (previous: boolean) => boolean) => void
    reload: () => void
}

export function useFileNavigation<T>({ list, initialPath = '', initialShowHidden = false, onDirectoryLoaded }: UseFileNavigationOptions<T>): FileNavigation<T> {
    const [requestedPath, setRequestedPath] = useState(initialPath)
    const [directory, setDirectory] = useState<{ path: string; entries: T[] } | null>(null)
    const [pending, setPending] = useState(true)
    const [showHidden, setShowHidden] = useState(initialShowHidden)
    const requestRef = useRef(0)
    const loadedRef = useRef(onDirectoryLoaded)

    useEffect(() => {
        loadedRef.current = onDirectoryLoaded
    })

    const load = useCallback(async (path: string) => {
        const request = ++requestRef.current
        setPending(true)
        let entries: T[] = []
        try {
            entries = await list(path, showHidden)
        } catch {
            entries = []
        }
        if (request !== requestRef.current) return
        setDirectory({ path, entries })
        setPending(false)
        loadedRef.current?.(path, entries)
    }, [list, showHidden])

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void load(requestedPath)
    }, [requestedPath, load])

    const currentPath = directory?.path ?? requestedPath

    const enter = useCallback((name: string) => setRequestedPath(currentPath ? `${currentPath}/${name}` : name), [currentPath])

    const goUp = useCallback(() => {
        const parts = currentPath.split('/').filter(Boolean)
        parts.pop()
        setRequestedPath(parts.join('/'))
    }, [currentPath])

    const goHome = useCallback(() => setRequestedPath(''), [])

    const reload = useCallback(() => {
        setRequestedPath(currentPath)
        void load(currentPath)
    }, [load, currentPath])

    return {
        currentPath,
        entries: directory?.entries ?? [],
        depth: currentPath.split('/').filter(Boolean).length,
        loading: directory === null,
        busy: pending && directory !== null,
        showHidden,
        navigate: setRequestedPath,
        enter,
        goUp,
        goHome,
        setShowHidden,
        reload,
    }
}
