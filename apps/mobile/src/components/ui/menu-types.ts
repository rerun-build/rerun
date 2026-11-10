import type { ReactElement, ReactNode } from 'react'

import type { SystemSymbolIcon } from '@/components/ui/system-symbols'

// The icon of a menu row: drawn by `Icon` on Android, by its SF Symbol in an iOS system menu.
export type MenuIcon = SystemSymbolIcon

export type NativeMenuProps = {
    trigger: ReactElement
    // MenuItem, MenuToggle, MenuSection and SubMenu rows.
    children: ReactNode
    // Draws the trigger as a button of this shape: system glass on iOS, an opaque surface on Android.
    glass?: 'circle' | 'capsule'
    // Read by the screen reader on the trigger.
    label?: string
}

export type MenuItemProps = {
    label: string
    icon?: MenuIcon
    // A row given a subtitle, even null, is laid out as a title over a second line.
    subtitle?: string | null
    destructive?: boolean
    disabled?: boolean
    onPress: () => void
}

// A workspace's logo, from a local file, or its initials when it has none.
export type MenuBadge = { imageUri: string } | { initials: string }

export type MenuToggleProps = {
    label: string
    icon?: MenuIcon
    badge?: MenuBadge
    isOn: boolean
    onChange: () => void
}

export type MenuSectionProps = { title?: string; children: ReactNode }

export type SubMenuProps = { label: string; icon?: MenuIcon; children: ReactNode }

export type LongPressMenuProps = {
    // What a tap opens.
    onPress: () => void
    label: string
    // The rows a long press shows.
    items: ReactNode
    children: ReactElement
}
