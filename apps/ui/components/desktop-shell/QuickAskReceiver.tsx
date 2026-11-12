'use client'

import { takeQuickAsk, QUICK_ASK_STORAGE_KEY } from '@/lib/desktop-shell/quick-ask'
import { useForemanStore } from '@/stores/foreman.store'
import { useEffect } from 'react'

// The main window of the desktop app takes what the Quick ask window handed over and asks the Chief
// of Staff in a new conversation.
export function QuickAskReceiver() {
    useEffect(() => {
        const ask = () => {
            const text = takeQuickAsk()
            if (!text) return
            const foreman = useForemanStore.getState()
            foreman.newChat()
            foreman.askForeman(text)
        }
        ask()
        const onStorage = (event: StorageEvent) => {
            if (event.key === QUICK_ASK_STORAGE_KEY && event.newValue) ask()
        }
        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
    }, [])
    return null
}
