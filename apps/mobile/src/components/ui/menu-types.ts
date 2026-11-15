import type { ReactElement, ReactNode } from 'react'

import type { SystemSymbolIcon } from '@/components/ui/system-symbols'

export type MenuIcon = SystemSymbolIcon

export type NativeMenuProps = {
    trigger: ReactElement
    children: ReactNode
    glass?: 'circle' | 'capsule'
    label?: string
}

export type MenuItemProps = {
    label: string
    icon?: MenuIcon
    subtitle?: string | null
    destructive?: boolean
    disabled?: boolean
    onPress: () => void
}

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
    onPress: () => void
    label: string
    items: ReactNode
    children: ReactElement
}
