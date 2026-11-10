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
} as const satisfies Partial<Record<IconName, SystemSymbol>>

export type SystemSymbolIcon = keyof typeof SYSTEM_SYMBOLS

export function systemSymbolOf(name: SystemSymbolIcon): SystemSymbol {
    return SYSTEM_SYMBOLS[name]
}
