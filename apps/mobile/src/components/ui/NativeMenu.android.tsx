import { Column, DropdownMenu, DropdownMenuItem, Host, HorizontalDivider, RNHostView, Text } from '@expo/ui/jetpack-compose'
import { padding } from '@expo/ui/jetpack-compose/modifiers'
import { Image } from 'expo-image'
import { createContext, Fragment, use, useState, type ReactElement, type ReactNode } from 'react'
import { Pressable, View } from 'react-native'

import { AppText } from '@/components/ui/AppText'
import { GLASS_BUTTON_SIZE } from '@/components/ui/GlassButton'
import { Icon, type IconName } from '@/components/ui/Icon'
import type { LongPressMenuProps, MenuBadge, MenuItemProps, MenuSectionProps, MenuToggleProps, NativeMenuProps, SubMenuProps } from '@/components/ui/menu-types'
import { opaqueSurface } from '@/components/ui/surface'
import { useTheme } from '@/theme/theme'
import { fonts, radius, spacing, withAlpha } from '@/theme/tokens'

export type { MenuBadge, MenuIcon } from '@/components/ui/menu-types'

const GLYPH = 18
const BADGE = 22
// A Compose host clips to its bounds: the trigger sits inset by this much so its shadow is not cut,
// and the host gives the room back with a negative margin so the layout does not move.
const SHADOW_ROOM = 8

// A row closes the menu it sits in before it runs its action, as a system menu does.
const CloseMenu = createContext<() => void>(() => {})

// Each opening mounts the rows afresh, so a submenu unfolded last time is folded again.
function useMenuState() {
    const [open, setOpen] = useState(false)
    const [openings, setOpenings] = useState(0)
    return {
        open,
        openings,
        show: () => {
            setOpenings(count => count + 1)
            setOpen(true)
        },
        hide: () => setOpen(false),
    }
}

type MenuState = ReturnType<typeof useMenuState>

// The menu itself, anchored under `children` (above when the screen has no room below): Compose's
// DropdownMenu on the theme's card, the app's font and icons, no Material look.
function AnchoredMenu({ menu, items, children }: { menu: MenuState; items: ReactNode; children: ReactElement }) {
    const theme = useTheme()
    return (
        <Host matchContents colorScheme={theme.scheme} style={{ margin: -SHADOW_ROOM }}>
            <DropdownMenu expanded={menu.open} onDismissRequest={menu.hide} color={theme.card} cornerRadius={radius.lg} shadowElevation={6}>
                <DropdownMenu.Trigger>
                    <RNHostView matchContents>
                        <View style={{ padding: SHADOW_ROOM }}>{children}</View>
                    </RNHostView>
                </DropdownMenu.Trigger>
                <DropdownMenu.Items>
                    <CloseMenu value={menu.hide}>
                        <Fragment key={menu.openings}>{items}</Fragment>
                    </CloseMenu>
                </DropdownMenu.Items>
            </DropdownMenu>
        </Host>
    )
}

// The iOS system menu's Android twin: a tap on `trigger` opens a menu anchored to it.
export function NativeMenu({ trigger, children, glass, label }: NativeMenuProps) {
    const theme = useTheme()
    const menu = useMenuState()
    const surface = glass ? { ...opaqueSurface(theme.scheme), borderRadius: glass === 'circle' ? GLASS_BUTTON_SIZE / 2 : radius.pill } : undefined
    return (
        <AnchoredMenu menu={menu} items={children}>
            <Pressable onPress={menu.show} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: menu.open }} android_ripple={{ color: withAlpha(theme.foreground, 0.12), borderless: glass === 'circle', radius: glass === 'circle' ? GLASS_BUTTON_SIZE / 2 : undefined }} style={surface}>
                {trigger}
            </Pressable>
        </AnchoredMenu>
    )
}

function RowText({ label, subtitle, color }: { label: string; subtitle?: string | null; color: string }) {
    const theme = useTheme()
    return (
        <Column>
            <Text color={color} maxLines={1} overflow="ellipsis" style={{ fontFamily: fonts.regular, fontSize: 15 }}>
                {label}
            </Text>
            {subtitle ? (
                <Text color={theme.mutedForeground} maxLines={1} overflow="ellipsis" style={{ fontFamily: fonts.regular, fontSize: 13 }}>
                    {subtitle}
                </Text>
            ) : null}
        </Column>
    )
}

function Glyph({ name, color }: { name: IconName; color: string }) {
    return (
        <RNHostView matchContents>
            <View style={{ width: BADGE, height: BADGE, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={name} size={GLYPH} color={color} />
            </View>
        </RNHostView>
    )
}

function Badge({ badge }: { badge: MenuBadge }) {
    const theme = useTheme()
    return (
        <RNHostView matchContents>
            <View style={{ width: BADGE, height: BADGE, borderRadius: BADGE / 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: theme.muted }}>
                {'imageUri' in badge ? (
                    <Image source={{ uri: badge.imageUri }} contentFit="cover" style={{ width: BADGE, height: BADGE }} />
                ) : (
                    <AppText medium maxFontSizeMultiplier={1} style={{ fontSize: 10, lineHeight: 12 }}>
                        {badge.initials}
                    </AppText>
                )}
            </View>
        </RNHostView>
    )
}

export function MenuItem({ label, icon, subtitle, destructive = false, disabled = false, onPress }: MenuItemProps) {
    const theme = useTheme()
    const close = use(CloseMenu)
    const color = disabled ? theme.mutedForeground : destructive ? theme.destructive : theme.foreground
    return (
        <DropdownMenuItem
            enabled={!disabled}
            onClick={() => {
                close()
                onPress()
            }}
        >
            <DropdownMenuItem.Text>
                <RowText label={label} subtitle={subtitle} color={color} />
            </DropdownMenuItem.Text>
            {icon ? (
                <DropdownMenuItem.LeadingIcon>
                    <Glyph name={icon} color={destructive && !disabled ? theme.destructive : theme.mutedForeground} />
                </DropdownMenuItem.LeadingIcon>
            ) : null}
        </DropdownMenuItem>
    )
}

// A checked row: the check sits at the end, where Android menus put it.
export function MenuToggle({ label, icon, badge, isOn, onChange }: MenuToggleProps) {
    const theme = useTheme()
    const close = use(CloseMenu)
    return (
        <DropdownMenuItem
            onClick={() => {
                close()
                onChange()
            }}
        >
            <DropdownMenuItem.Text>
                <RowText label={label} color={theme.foreground} />
            </DropdownMenuItem.Text>
            {badge || icon ? <DropdownMenuItem.LeadingIcon>{badge ? <Badge badge={badge} /> : icon ? <Glyph name={icon} color={theme.mutedForeground} /> : null}</DropdownMenuItem.LeadingIcon> : null}
            {isOn ? (
                <DropdownMenuItem.TrailingIcon>
                    <Glyph name="check" color={theme.foreground} />
                </DropdownMenuItem.TrailingIcon>
            ) : null}
        </DropdownMenuItem>
    )
}

// A hairline, then the section's title in small muted type, then its rows.
export function MenuSection({ title, children }: MenuSectionProps) {
    const theme = useTheme()
    return (
        <>
            <HorizontalDivider color={theme.border} modifiers={[padding(0, spacing.xs, 0, spacing.xs)]} />
            {title ? (
                <Text color={theme.mutedForeground} style={{ fontFamily: fonts.medium, fontSize: 12 }} modifiers={[padding(spacing.lg, spacing.xs, spacing.lg, spacing.xs)]}>
                    {title}
                </Text>
            ) : null}
            {children}
        </>
    )
}

// Android menus do not cascade: a submenu is a row that unfolds its rows in place.
export function SubMenu({ label, icon, children }: SubMenuProps) {
    const theme = useTheme()
    const [open, setOpen] = useState(false)
    return (
        <>
            <DropdownMenuItem onClick={() => setOpen(shown => !shown)}>
                <DropdownMenuItem.Text>
                    <RowText label={label} color={theme.foreground} />
                </DropdownMenuItem.Text>
                {icon ? (
                    <DropdownMenuItem.LeadingIcon>
                        <Glyph name={icon} color={theme.mutedForeground} />
                    </DropdownMenuItem.LeadingIcon>
                ) : null}
                <DropdownMenuItem.TrailingIcon>
                    <Glyph name={open ? 'chevron-up' : 'chevron-down'} color={theme.mutedForeground} />
                </DropdownMenuItem.TrailingIcon>
            </DropdownMenuItem>
            {open ? children : null}
        </>
    )
}

// A tap runs `onPress`, a long press opens the same anchored menu as NativeMenu.
export function LongPressMenu({ onPress, label, items, children }: LongPressMenuProps) {
    const theme = useTheme()
    const menu = useMenuState()
    return (
        <AnchoredMenu menu={menu} items={items}>
            <Pressable onPress={onPress} onLongPress={menu.show} accessibilityRole="button" accessibilityLabel={label} android_ripple={{ color: withAlpha(theme.foreground, 0.08), borderless: false }}>
                {children}
            </Pressable>
        </AnchoredMenu>
    )
}

export function CircleTrigger({ symbol, children }: { symbol?: IconName; children?: ReactNode }) {
    const theme = useTheme()
    return (
        <View style={{ width: GLASS_BUTTON_SIZE, height: GLASS_BUTTON_SIZE, borderRadius: GLASS_BUTTON_SIZE / 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            {symbol ? <Icon name={symbol} size={18} color={theme.foreground} /> : children}
        </View>
    )
}
