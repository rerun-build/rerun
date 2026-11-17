import { defaultQuickAskAccelerator, quickAskAccelerator, type DesktopShellPlatform } from '@rerun/contracts'

type StoredQuickAsk = { quickAsk?: boolean; quickAskShortcut?: string | null }

// Settings written before the shortcut could change only say whether Quick ask is on; a shortcut the
// shell no longer accepts falls back to the default rather than to nothing.
export function storedQuickAskShortcut(stored: StoredQuickAsk, platform: DesktopShellPlatform): string | null {
    if (stored.quickAskShortcut === null) return null
    if (stored.quickAskShortcut !== undefined) return quickAskAccelerator(stored.quickAskShortcut) ?? defaultQuickAskAccelerator(platform)
    return stored.quickAsk === false ? null : defaultQuickAskAccelerator(platform)
}
