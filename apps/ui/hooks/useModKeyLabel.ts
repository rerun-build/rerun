import { useSyncExternalStore } from 'react'

const subscribe = () => () => {}
const readClient = () => (/Mac|iPhone|iPad/i.test(navigator.userAgent) ? '⌘' : 'Ctrl')
const readServer = () => 'Ctrl'

export function useModKeyLabel(): string {
    return useSyncExternalStore(subscribe, readClient, readServer)
}
