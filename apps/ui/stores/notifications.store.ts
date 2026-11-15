import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { AnnouncedNotification } from '@/lib/notifications/announcement'
import { useForemanStore } from '@/stores/foreman.store'

type NotificationsState = {
    open: boolean
    targetAgentId: string | null
    openNotifications: (agentId?: string) => void
    setOpen: (open: boolean) => void
    permissionPromptOpen: boolean
    permissionAsked: boolean
    askPermission: () => void
    answerPermission: () => void
    arrivals: AnnouncedNotification[]
    announce: (notification: AnnouncedNotification) => void
}

export const useNotificationsStore = create<NotificationsState>()(
    persist(
        (set, get) => ({
            open: false,
            targetAgentId: null,
            openNotifications: agentId => set({ open: true, targetAgentId: agentId ?? null }),
            setOpen: open => set({ open }),
            permissionPromptOpen: false,
            permissionAsked: false,
            askPermission: () => {
                if (get().permissionAsked || useForemanStore.getState().funnel !== 'companion') return
                set({ permissionPromptOpen: true })
            },
            answerPermission: () => set({ permissionPromptOpen: false, permissionAsked: true }),
            arrivals: [],
            announce: notification => set(state => ({ arrivals: [...state.arrivals, notification] })),
        }),
        {
            name: 'rerun:notifications-ui',
            partialize: state => ({ permissionAsked: state.permissionAsked }),
        }
    )
)
