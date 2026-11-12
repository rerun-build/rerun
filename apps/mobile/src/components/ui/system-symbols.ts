import type { Image } from '@expo/ui/swift-ui'
import type { ComponentProps } from 'react'

import type { IconName } from '@/components/ui/icon-names'

export type SystemSymbol = NonNullable<ComponentProps<typeof Image>['systemName']>

// An iOS system menu (UIMenu) draws its rows' icons natively and takes only an SF Symbol: the symbol of
// each icon the app shows in one, everywhere else drawn by `Icon`.
const SYSTEM_SYMBOLS = {
    'message-circle-question-fill': 'questionmark.bubble.fill',
    'shield-check-fill': 'checkmark.shield.fill',
    link: 'link',
    'message-circle-warning-fill': 'exclamationmark.bubble.fill',
    'hand-fill': 'hand.raised.fill',
    'triangle-alert-fill': 'exclamationmark.triangle.fill',
    'refresh-cw': 'arrow.triangle.2.circlepath',
    'circle-fill': 'circle.fill',
    building: 'building.2',
    info: 'info.circle',
    plus: 'plus',
    'square-pen': 'square.and.pencil',
    'messages-square': 'bubble.left.and.bubble.right',
    settings: 'gearshape',
    'credit-card': 'creditcard',
    'message-circle': 'bubble.left',
    'log-out': 'rectangle.portrait.and.arrow.right',
    layers: 'square.stack',
    trash: 'trash',
    'pin-off': 'pin.slash',
    'arrow-up-down': 'arrow.up.arrow.down',
    images: 'photo.on.rectangle',
    camera: 'camera',
    folder: 'folder',
    book: 'book',
} as const satisfies Partial<Record<IconName, SystemSymbol>>

export type SystemSymbolIcon = keyof typeof SYSTEM_SYMBOLS

export function systemSymbolOf(name: SystemSymbolIcon): SystemSymbol {
    return SYSTEM_SYMBOLS[name]
}

// The system menu draws neither text nor a remote image as an icon: a row without one gets the lettered
// symbol of its first initial.
export function initialSymbol(initials: string): SystemSymbol {
    const letter = initials[0]?.toLowerCase()
    return letter && /^[a-z]$/.test(letter) ? (`${letter}.circle.fill` as SystemSymbol) : 'building.2'
}
