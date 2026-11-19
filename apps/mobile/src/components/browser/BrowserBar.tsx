import { Button, HStack, Host, Image, Menu, Text } from '@expo/ui/swift-ui'
import { accessibilityLabel, buttonBorderShape, buttonStyle, font, foregroundStyle, frame, glassEffect, lineLimit, padding, tint } from '@expo/ui/swift-ui/modifiers'

import { GLASS_BUTTON_SIZE, GLASS_INSET } from '@/components/ui/GlassButton'
import type { SystemSymbol } from '@/components/ui/system-symbols'
import { spacing } from '@/theme/tokens'

import type { BrowserBarProps } from './browser-bar-types'

// Seen on iOS 26: in the dark scheme the glass turns its glyphs to the page under it, light over a dark
// page and dark over a light one; in the light scheme they stay dark, lost over a dark page. The menu's
// label follows the same primary tint, not the accent color it would take as a button.
const BAR_SCHEME = 'dark'
const ADAPTIVE = foregroundStyle({ type: 'hierarchical', style: 'primary' })

function RoundButton({ symbol, label, onPress }: { symbol: SystemSymbol; label: string; onPress: () => void }) {
    const inner = GLASS_BUTTON_SIZE - 2 * GLASS_INSET
    return (
        <Button onPress={onPress} modifiers={[buttonStyle('glass'), buttonBorderShape('circle'), accessibilityLabel(label)]}>
            <Image systemName={symbol} size={17} modifiers={[frame({ width: inner, height: inner }), ADAPTIVE]} />
        </Button>
    )
}

export function BrowserBar({ host, labels, onClose, onReload, children }: BrowserBarProps) {
    return (
        <Host matchContents={{ vertical: true }} colorScheme={BAR_SCHEME} style={{ alignSelf: 'stretch' }}>
            <HStack spacing={spacing.sm}>
                <RoundButton symbol="xmark" label={labels.close} onPress={onClose} />
                <Menu
                    label={
                        <HStack spacing={spacing.sm} modifiers={[padding({ horizontal: spacing.lg }), frame({ maxWidth: Infinity, minHeight: GLASS_BUTTON_SIZE })]}>
                            <Text modifiers={[font({ textStyle: 'footnote', weight: 'medium' }), lineLimit(1), ADAPTIVE]}>{host}</Text>
                            <Image systemName="ellipsis" size={13} modifiers={[foregroundStyle({ type: 'hierarchical', style: 'secondary' })]} />
                        </HStack>
                    }
                    modifiers={[tint({ type: 'hierarchical', style: 'primary' }), glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'capsule' }), accessibilityLabel(labels.pageActions)]}
                >
                    {children}
                </Menu>
                <RoundButton symbol="arrow.clockwise" label={labels.reload} onPress={onReload} />
            </HStack>
        </Host>
    )
}
