import { Column, DropdownMenu, DropdownMenuItem, Host, HorizontalDivider, RNHostView, Text } from '@expo/ui/jetpack-compose'
import { height, padding } from '@expo/ui/jetpack-compose/modifiers'
import { Image } from 'expo-image'
import { Children, createContext, Fragment, isValidElement, use, useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { BackHandler, Pressable, View } from 'react-native'

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

// A single-line row as tall as an iOS menu row; Compose's default (48 dp) read as too tall.
const ROW_HEIGHT = 44
const NESTED_INDENT = spacing.lg

// A row closes the menu it sits in before it runs its action, as a system menu does.
const CloseMenu = createContext<() => void>(() => {})

// `iconColumn`: some row of the menu has an icon, so a row without one keeps the column empty and its
// label lines up with the others. `depth`: how many submenus the row is unfolded in.
const RowLayout = createContext({ iconColumn: false, depth: 0 })

function someRowHasIcon(rows: ReactNode): boolean {
    return Children.toArray(rows).some(row => {
        if (!isValidElement<{ icon?: unknown; badge?: unknown; children?: ReactNode }>(row)) return false
        if (row.props.icon || row.props.badge) return true
        return row.type === Fragment || row.type === MenuSection ? someRowHasIcon(row.props.children) : false
    })
}

function useRowModifiers({ singleLine }: { singleLine: boolean }) {
    const { depth } = use(RowLayout)
    return [...(singleLine ? [height(ROW_HEIGHT)] : []), ...(depth > 0 ? [padding(NESTED_INDENT * depth, 0, 0, 0)] : [])]
}

// Each opening mounts the rows afresh, so a submenu unfolded last time is folded again. The popup does
// not take the focus (see AnchoredMenu), so the back gesture reaches the app, which closes the menu.
function useMenuState() {
    const [open, setOpen] = useState(false)
    const [openings, setOpenings] = useState(0)
    useEffect(() => {
        if (!open) return
        const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
            setOpen(false)
            return true
        })
        return () => subscription.remove()
    }, [open])
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
// DropdownMenu on the theme's card, the app's font and icons, no Material look. A focusable popup would
// take the focus from a text field and close the keyboard without the screen hearing of it: the
// composer stayed lifted over an empty space.
function AnchoredMenu({ menu, items, children }: { menu: MenuState; items: ReactNode; children: ReactElement }) {
    const theme = useTheme()
    return (
        <Host matchContents colorScheme={theme.scheme} style={{ margin: -SHADOW_ROOM }}>
            <DropdownMenu expanded={menu.open} onDismissRequest={menu.hide} properties={{ focusable: false }} color={theme.card} cornerRadius={radius.lg} shadowElevation={6}>
                <DropdownMenu.Trigger>
                    <RNHostView matchContents>
                        <View style={{ padding: SHADOW_ROOM }}>{children}</View>
                    </RNHostView>
                </DropdownMenu.Trigger>
                <DropdownMenu.Items>
                    <CloseMenu value={menu.hide}>
                        <RowLayout value={{ iconColumn: someRowHasIcon(items), depth: 0 }}>
                            <Fragment key={menu.openings}>{items}</Fragment>
                        </RowLayout>
                    </CloseMenu>
                </DropdownMenu.Items>
            </DropdownMenu>
        </Host>
    )
}

// The iOS system menu's Android twin: a tap on `trigger` opens a menu anchored to it. TalkBack reads the
// pressable around the trigger, not the trigger: it takes the trigger's label when the menu has none.
export function NativeMenu({ trigger, children, glass, label }: NativeMenuProps) {
    const theme = useTheme()
    const menu = useMenuState()
    const triggerLabel = (trigger.props as { accessibilityLabel?: string }).accessibilityLabel
    const surface = glass ? { ...opaqueSurface(theme.scheme), borderRadius: glass === 'circle' ? GLASS_BUTTON_SIZE / 2 : radius.pill } : undefined
    return (
        <AnchoredMenu menu={menu} items={children}>
            <Pressable onPress={menu.show} accessibilityRole="button" accessibilityLabel={label ?? triggerLabel} accessibilityState={{ expanded: menu.open }} android_ripple={{ color: withAlpha(theme.foreground, 0.12), borderless: glass === 'circle', radius: glass === 'circle' ? GLASS_BUTTON_SIZE / 2 : undefined }} style={surface}>
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

function IconSpace() {
    return (
        <RNHostView matchContents>
            <View testID="menu-icon-space" style={{ width: BADGE, height: BADGE }} />
        </RNHostView>
    )
}

// The row's icon, an empty column when another row has one, nothing in a menu without icons.
function LeadingSlot({ children }: { children: ReactNode }) {
    const { iconColumn } = use(RowLayout)
    if (children) return <DropdownMenuItem.LeadingIcon>{children}</DropdownMenuItem.LeadingIcon>
    if (!iconColumn) return null
    return (
        <DropdownMenuItem.LeadingIcon>
            <IconSpace />
        </DropdownMenuItem.LeadingIcon>
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
    const modifiers = useRowModifiers({ singleLine: subtitle === undefined })
    return (
        <DropdownMenuItem
            enabled={!disabled}
            modifiers={modifiers}
            onClick={() => {
                close()
                onPress()
            }}
        >
            <DropdownMenuItem.Text>
                <RowText label={label} subtitle={subtitle} color={color} />
            </DropdownMenuItem.Text>
            <LeadingSlot>{icon ? <Glyph name={icon} color={destructive && !disabled ? theme.destructive : theme.mutedForeground} /> : null}</LeadingSlot>
        </DropdownMenuItem>
    )
}

// A checked row: the check sits at the end, where Android menus put it.
export function MenuToggle({ label, icon, badge, isOn, onChange }: MenuToggleProps) {
    const theme = useTheme()
    const close = use(CloseMenu)
    const modifiers = useRowModifiers({ singleLine: true })
    return (
        <DropdownMenuItem
            modifiers={modifiers}
            onClick={() => {
                close()
                onChange()
            }}
        >
            <DropdownMenuItem.Text>
                <RowText label={label} color={theme.foreground} />
            </DropdownMenuItem.Text>
            <LeadingSlot>{badge ? <Badge badge={badge} /> : icon ? <Glyph name={icon} color={theme.mutedForeground} /> : null}</LeadingSlot>
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
    const layout = use(RowLayout)
    const modifiers = useRowModifiers({ singleLine: true })
    return (
        <>
            <DropdownMenuItem modifiers={modifiers} onClick={() => setOpen(shown => !shown)}>
                <DropdownMenuItem.Text>
                    <RowText label={label} color={theme.foreground} />
                </DropdownMenuItem.Text>
                <LeadingSlot>{icon ? <Glyph name={icon} color={theme.mutedForeground} /> : null}</LeadingSlot>
                <DropdownMenuItem.TrailingIcon>
                    <Glyph name={open ? 'chevron-up' : 'chevron-down'} color={theme.mutedForeground} />
                </DropdownMenuItem.TrailingIcon>
            </DropdownMenuItem>
            {open ? <RowLayout value={{ iconColumn: layout.iconColumn || someRowHasIcon(children), depth: layout.depth + 1 }}>{children}</RowLayout> : null}
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
