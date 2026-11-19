import { useSyncExternalStore } from 'react'
import { clearTabWorkspace } from './tab-workspace'
import { routes } from '@/lib/routes'

let switching = false
let loaderVisible = false
const listeners = new Set<() => void>()

function setState(nextSwitching: boolean, nextLoaderVisible: boolean) {
    switching = nextSwitching
    if (loaderVisible === nextLoaderVisible) return
    loaderVisible = nextLoaderVisible
    listeners.forEach(listener => listener())
}

export function beginWorkspaceSwitch({ loader = true }: { loader?: boolean } = {}) {
    setState(true, loader)
}

export function abortWorkspaceSwitch() {
    setState(false, false)
}

export function enterActiveWorkspace() {
    setState(true, true)
    clearTabWorkspace()
    window.location.assign(window.location.pathname === routes.home ? routes.home : routes.board)
}

export function isWorkspaceSwitchInFlight() {
    return switching
}

function subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

export function useWorkspaceSwitchLoader() {
    return useSyncExternalStore(
        subscribe,
        () => loaderVisible,
        () => false
    )
}
