import { DEFAULT_QUICK_ASK_VOICE_ACCELERATOR, defaultQuickAskAccelerator, quickAskAccelerator, type DesktopShellPlatform } from '@rerun/contracts'

type StoredQuickAsk = { quickAsk?: boolean; quickAskShortcut?: string | null }

// Settings written before the shortcut could change only say whether Quick ask is on; a shortcut the
// shell no longer accepts falls back to the default rather than to nothing.
export function storedQuickAskShortcut(stored: StoredQuickAsk, platform: DesktopShellPlatform): string | null {
    if (stored.quickAskShortcut === null) return null
    if (stored.quickAskShortcut !== undefined) return quickAskAccelerator(stored.quickAskShortcut) ?? defaultQuickAskAccelerator(platform)
    return stored.quickAsk === false ? null : defaultQuickAskAccelerator(platform)
}

// Absent until the person changes it: a fresh install and an updated one both get the default.
export function storedQuickAskVoiceShortcut(stored: { quickAskVoiceShortcut?: string | null }): string | null {
    if (stored.quickAskVoiceShortcut === null) return null
    if (stored.quickAskVoiceShortcut === undefined) return DEFAULT_QUICK_ASK_VOICE_ACCELERATOR
    return quickAskAccelerator(stored.quickAskVoiceShortcut) ?? DEFAULT_QUICK_ASK_VOICE_ACCELERATOR
}
