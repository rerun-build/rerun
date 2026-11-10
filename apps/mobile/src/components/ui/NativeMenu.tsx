import { Button, ContextMenu, Host, Image, Label, Menu, RNHostView, Section, Text, Toggle } from '@expo/ui/swift-ui'
import { accessibilityLabel, buttonStyle, disabled as disabledModifier, glassEffect } from '@expo/ui/swift-ui/modifiers'
import type { ReactNode } from 'react'
import { View } from 'react-native'

import { GLASS_BUTTON_SIZE } from '@/components/ui/GlassButton'
import { Icon, type IconName } from '@/components/ui/Icon'
import type { LongPressMenuProps, MenuItemProps, MenuSectionProps, MenuToggleProps, NativeMenuProps, SubMenuProps } from '@/components/ui/menu-types'
import { initialSymbol, systemSymbolOf } from '@/components/ui/system-symbols'
import { useTheme } from '@/theme/theme'

export type { MenuBadge, MenuIcon } from '@/components/ui/menu-types'

// A tap on `trigger` opens the system menu (UIMenu, in glass on iOS 26). Its rows are the
// platform-neutral MenuItem, MenuToggle, MenuSection and SubMenu below; Android draws its own.
export function NativeMenu({ trigger, children, glass, label }: NativeMenuProps) {
    const theme = useTheme()
    const modifiers = [...(glass ? [glassEffect({ glass: { variant: 'regular', interactive: true }, shape: glass })] : []), ...(label ? [accessibilityLabel(label)] : [])]
    return (
        <Host matchContents colorScheme={theme.scheme}>
            <Menu label={<RNHostView matchContents>{trigger}</RNHostView>} modifiers={modifiers}>
                {children}
            </Menu>
        </Host>
    )
}

export function MenuItem({ label, icon, subtitle, destructive = false, disabled, onPress }: MenuItemProps) {
    const modifiers = disabled === undefined ? undefined : [disabledModifier(disabled)]
    if (subtitle !== undefined) {
        return (
            <Button onPress={onPress} modifiers={modifiers}>
                {icon ? <Image systemName={systemSymbolOf(icon)} /> : <Text>{''}</Text>}
                <Text>{label}</Text>
                {subtitle ? <Text>{subtitle}</Text> : <Text>{''}</Text>}
            </Button>
        )
    }
    return <Button label={label} systemImage={icon ? systemSymbolOf(icon) : undefined} role={destructive ? 'destructive' : undefined} onPress={onPress} modifiers={modifiers} />
}

export function MenuToggle({ label, icon, badge, isOn, onChange }: MenuToggleProps) {
    if (badge) {
        return (
            <Toggle isOn={isOn} onIsOnChange={onChange}>
                {'imageUri' in badge ? <Label title={label} icon={<Image uiImage={badge.imageUri} />} /> : <Label title={label} systemImage={initialSymbol(badge.initials)} />}
            </Toggle>
        )
    }
    return <Toggle label={label} systemImage={icon ? systemSymbolOf(icon) : undefined} isOn={isOn} onIsOnChange={onChange} />
}

export function MenuSection({ title, children }: MenuSectionProps) {
    return <Section title={title}>{children}</Section>
}

export function SubMenu({ label, icon, children }: SubMenuProps) {
    return (
        <Menu label={label} systemImage={icon ? systemSymbolOf(icon) : undefined}>
            {children}
        </Menu>
    )
}

// A tap runs `onPress`, a long press opens the system's context menu. The cell is a SwiftUI button
// around an inert RN view, so both gestures stay native.
export function LongPressMenu({ onPress, label, items, children }: LongPressMenuProps) {
    const theme = useTheme()
    return (
        <Host matchContents colorScheme={theme.scheme}>
            <ContextMenu>
                <ContextMenu.Items>{items}</ContextMenu.Items>
                <ContextMenu.Trigger>
                    <Button onPress={onPress} modifiers={[buttonStyle('plain'), accessibilityLabel(label)]}>
                        <RNHostView matchContents>{children}</RNHostView>
                    </Button>
                </ContextMenu.Trigger>
            </ContextMenu>
        </Host>
    )
}

// What a round glass trigger holds: an icon, or an avatar cut to the circle.
export function CircleTrigger({ symbol, children }: { symbol?: IconName; children?: ReactNode }) {
    const theme = useTheme()
    return (
        <View style={{ width: GLASS_BUTTON_SIZE, height: GLASS_BUTTON_SIZE, borderRadius: GLASS_BUTTON_SIZE / 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            {symbol ? <Icon name={symbol} size={18} color={theme.foreground} /> : children}
        </View>
    )
}
