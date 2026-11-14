'use client'

import type { DesktopShellApi } from '@rerun/contracts'
import { pageAttention } from '@/lib/desktop-shell/attention'
import { desktopShell } from '@/lib/desktop-shell/client'

const SOUND_URL = '/sounds/notification.mp3'

export type BrowserPermission = 'default' | 'granted' | 'denied' | 'unsupported'

export function browserPermission(): BrowserPermission {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
    return Notification.permission
}

export async function requestBrowserPermission(): Promise<BrowserPermission> {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
    try {
        return await Notification.requestPermission()
    } catch {
        return browserPermission()
    }
}

type ShowNotificationArgs = { title: string; body?: string; tag?: string; icon?: string; onClick?: () => void }

const desktopClicks = new Map<string, () => void>()
const MAX_PENDING_CLICKS = 50
let listeningToDesktopClicks = false

function showDesktopNotification(shell: DesktopShellApi, { title, body, tag, onClick }: ShowNotificationArgs): void {
    if (pageAttention() === 'focused') return
    const id = tag ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
    if (onClick) {
        desktopClicks.delete(id)
        desktopClicks.set(id, onClick)
        if (desktopClicks.size > MAX_PENDING_CLICKS) desktopClicks.delete(desktopClicks.keys().next().value!)
    }
    if (!listeningToDesktopClicks) {
        listeningToDesktopClicks = true
        shell.notifications.onClick(clicked => {
            const handler = desktopClicks.get(clicked)
            desktopClicks.delete(clicked)
            handler?.()
        })
    }
    void shell.notifications.show({ id, title, body, silent: true })
}

export function showBrowserNotification({ title, body, tag, icon = '/icon-192.png', onClick }: ShowNotificationArgs): void {
    const shell = desktopShell('notifications')
    if (shell) return showDesktopNotification(shell, { title, body, tag, onClick })
    if (browserPermission() !== 'granted') return
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') return
    try {
        const notification = new Notification(title, { body, tag, icon })
        notification.onclick = () => {
            window.focus()
            notification.close()
            onClick?.()
        }
    } catch {
    }
}

let sound: HTMLAudioElement | null = null

const SOUND_LOCK_PREFIX = 'rerun-notification-sound:'
const SOUND_CLAIM_KEY = 'rerun:notification-sound-claim'
const CLAIM_HOLD_MS = 10_000
const CLAIM_SETTLE_MS = 60

export function playNotificationSoundOnce(notificationId: string): void {
    if (typeof window === 'undefined') return
    if (navigator.locks) {
        void navigator.locks
            .request(SOUND_LOCK_PREFIX + notificationId, { ifAvailable: true }, async lock => {
                if (!lock || claimed(notificationId)) return
                markClaimed(notificationId)
                playNotificationSound()
                await new Promise(resolve => setTimeout(resolve, CLAIM_HOLD_MS))
            })
            .catch(() => {})
        return
    }
    if (claimed(notificationId)) return
    const token = `${notificationId}:${Math.random().toString(36).slice(2)}`
    writeClaim(token)
    setTimeout(() => {
        if (readClaim() === token) playNotificationSound()
    }, CLAIM_SETTLE_MS)
}

const claimedIds = new Set<string>()

function claimed(notificationId: string): boolean {
    return claimedIds.has(notificationId) || readClaim()?.startsWith(`${notificationId}:`) === true
}

function markClaimed(notificationId: string): void {
    claimedIds.add(notificationId)
    writeClaim(`${notificationId}:lock`)
}

function readClaim(): string | null {
    try {
        return localStorage.getItem(SOUND_CLAIM_KEY)
    } catch {
        return null
    }
}

function writeClaim(value: string): void {
    try {
        localStorage.setItem(SOUND_CLAIM_KEY, value)
    } catch {}
}

export function playNotificationSound(): void {
    if (typeof window === 'undefined') return
    try {
        if (!sound) sound = new Audio(SOUND_URL)
        sound.currentTime = 0
        void sound.play().catch(() => {})
    } catch {
    }
}
