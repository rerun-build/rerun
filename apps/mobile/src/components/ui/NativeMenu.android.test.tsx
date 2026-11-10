import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { BackHandler, Keyboard, Platform, Text, View } from 'react-native'

import { LongPressMenu, MenuItem, MenuSection, MenuToggle, NativeMenu, SubMenu } from '@/components/ui/NativeMenu'

// Compose views need the native ExpoUI module: each is drawn here as the plain view it stands for, the
// menu's rows shown only while the menu is expanded.
jest.mock('@expo/ui/jetpack-compose', () => {
    const { createContext, use } = jest.requireActual('react')
    const { Pressable, Text: RNText, View } = jest.requireActual('react-native')
    const Expanded = createContext(false)
    const passThrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>
    const DropdownMenu = ({ expanded, children }: { expanded: boolean; children: React.ReactNode }) => <View testID={expanded ? 'menu-open' : 'menu-closed'}>{children}</View>
    const Items = ({ children }: { children: React.ReactNode }) => (use(Expanded) ? <View>{children}</View> : null)
    DropdownMenu.Trigger = passThrough
    DropdownMenu.Items = Items
    const DropdownMenuItem = ({ onClick, enabled = true, modifiers = [], children }: { onClick: () => void; enabled?: boolean; modifiers?: unknown[]; children: React.ReactNode }) => (
        <Pressable accessibilityRole="menuitem" accessibilityState={{ disabled: !enabled }} disabled={!enabled} onPress={onClick} testID={`modifiers:${JSON.stringify(modifiers)}`}>
            {children}
        </Pressable>
    )
    DropdownMenuItem.Text = passThrough
    DropdownMenuItem.LeadingIcon = passThrough
    DropdownMenuItem.TrailingIcon = function TrailingIcon({ children }: { children: React.ReactNode }) {
        return <View testID="trailing">{children}</View>
    }
    return {
        Host: passThrough,
        RNHostView: passThrough,
        Column: passThrough,
        HorizontalDivider: () => <View testID="divider" />,
        Text: ({ children }: { children: React.ReactNode }) => <RNText>{children}</RNText>,
        DropdownMenu: Object.assign(
            ({ expanded, properties, children }: { expanded: boolean; properties?: { focusable?: boolean }; children: React.ReactNode }) => (
                <Expanded value={expanded}>
                    <View testID={properties?.focusable === false ? 'popup-keeps-focus-away' : 'popup-takes-focus'}>
                        <DropdownMenu expanded={expanded}>{children}</DropdownMenu>
                    </View>
                </Expanded>
            ),
            { Trigger: passThrough, Items },
        ),
        DropdownMenuItem,
    }
})
jest.mock('@expo/ui/jetpack-compose/modifiers', () => ({
    height: (value: number) => ({ height: value }),
    padding: (start: number) => ({ paddingStart: start }),
}))

const modifiersOf = (name: string | RegExp) => JSON.parse(screen.getByRole('menuitem', { name }).props.testID.replace('modifiers:', ''))

const describeOnAndroid = Platform.OS === 'android' ? describe : describe.skip

describeOnAndroid('NativeMenu on Android', () => {
    it('opens anchored to its trigger, and a row closes it before running its action', async () => {
        const onPreferences = jest.fn()
        await render(
            <NativeMenu label="Account" trigger={<Text>Me</Text>}>
                <MenuItem label="Preferences" icon="settings" onPress={onPreferences} />
            </NativeMenu>,
        )
        expect(screen.queryByText('Preferences')).toBeNull()
        await fireEvent.press(screen.getByRole('button', { name: 'Account' }))
        expect(screen.getByTestId('menu-open')).toBeTruthy()
        await fireEvent.press(screen.getByText('Preferences'))
        expect(onPreferences).toHaveBeenCalledTimes(1)
        expect(screen.getByTestId('menu-closed')).toBeTruthy()
    })

    it('keeps a disabled row from running', async () => {
        const onNew = jest.fn()
        await render(
            <NativeMenu label="Conversations" trigger={<Text>Chat</Text>}>
                <MenuItem label="New conversation" icon="plus" disabled onPress={onNew} />
            </NativeMenu>,
        )
        await fireEvent.press(screen.getByRole('button', { name: 'Conversations' }))
        const row = screen.getByRole('menuitem')
        expect(row).toBeDisabled()
        await fireEvent.press(row)
        expect(onNew).not.toHaveBeenCalled()
    })

    it('checks the chosen row at its end, and unfolds a submenu in place', async () => {
        const onSwitch = jest.fn()
        await render(
            <NativeMenu label="Account" trigger={<Text>Me</Text>}>
                <MenuSection title="Needs you">
                    <MenuItem label="CV to send" subtitle="Which CV should I send?" onPress={() => {}} />
                </MenuSection>
                <SubMenu label="Workspaces" icon="layers">
                    <MenuToggle label="Acme" badge={{ initials: 'A' }} isOn onChange={() => {}} />
                    <MenuToggle label="Atelier Nord" badge={{ initials: 'AN' }} isOn={false} onChange={onSwitch} />
                </SubMenu>
            </NativeMenu>,
        )
        await fireEvent.press(screen.getByRole('button', { name: 'Account' }))
        expect(screen.getByText('Needs you')).toBeTruthy()
        expect(screen.getByText('Which CV should I send?')).toBeTruthy()
        expect(screen.getByTestId('divider')).toBeTruthy()
        expect(screen.queryByText('Acme')).toBeNull()
        await fireEvent.press(screen.getByText('Workspaces'))
        expect(screen.getByText('Acme')).toBeTruthy()
        expect(screen.getAllByTestId('trailing')).toHaveLength(2)
        await fireEvent.press(screen.getByText('Atelier Nord'))
        expect(onSwitch).toHaveBeenCalledTimes(1)
    })

    it('folds a submenu again the next time the menu opens', async () => {
        await render(
            <NativeMenu label="Account" trigger={<Text>Me</Text>}>
                <SubMenu label="Workspaces">
                    <MenuToggle label="Acme" isOn onChange={() => {}} />
                </SubMenu>
            </NativeMenu>,
        )
        const trigger = screen.getByRole('button', { name: 'Account' })
        await fireEvent.press(trigger)
        await fireEvent.press(screen.getByText('Workspaces'))
        await fireEvent.press(screen.getByText('Acme'))
        await fireEvent.press(trigger)
        expect(screen.queryByText('Acme')).toBeNull()
    })
})

describeOnAndroid('NativeMenu and the keyboard on Android', () => {
    afterEach(() => jest.restoreAllMocks())

    it('takes the focus when no keyboard is up, so a tap outside only closes it', async () => {
        jest.spyOn(Keyboard, 'isVisible').mockReturnValue(false)
        await render(
            <NativeMenu label="Account" trigger={<Text>Me</Text>}>
                <MenuItem label="Preferences" icon="settings" onPress={() => {}} />
            </NativeMenu>,
        )
        await fireEvent.press(screen.getByRole('button', { name: 'Account' }))
        expect(screen.getByTestId('popup-takes-focus')).toBeTruthy()
    })

    it('leaves the focus to the text field over the keyboard, and closes on the back gesture', async () => {
        jest.spyOn(Keyboard, 'isVisible').mockReturnValue(true)
        type BackListener = Parameters<typeof BackHandler.addEventListener>[1]
        let listeners: BackListener[] = []
        jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, listener) => {
            listeners.push(listener)
            return { remove: () => (listeners = listeners.filter(registered => registered !== listener)) }
        })
        await render(
            <NativeMenu label="Attach" trigger={<Text>+</Text>}>
                <MenuItem label="Photos" icon="images" onPress={() => {}} />
            </NativeMenu>,
        )
        expect(listeners).toHaveLength(0)

        await fireEvent.press(screen.getByRole('button', { name: 'Attach' }))
        expect(screen.getByTestId('menu-open')).toBeTruthy()
        expect(screen.getByTestId('popup-keeps-focus-away')).toBeTruthy()
        let handled = false
        await act(async () => {
            handled = listeners.toReversed().some(listener => listener({} as Parameters<BackListener>[0]))
        })
        expect(handled).toBe(true)
        expect(screen.getByTestId('menu-closed')).toBeTruthy()
        expect(listeners).toHaveLength(0)
    })
})

describeOnAndroid('NativeMenu trigger on Android', () => {
    it("names its button after the trigger's own label when the menu has none", async () => {
        await render(
            <NativeMenu
                trigger={
                    <View accessibilityLabel="Attach">
                        <Text>+</Text>
                    </View>
                }
            >
                <MenuItem label="Photos" icon="images" onPress={() => {}} />
            </NativeMenu>,
        )
        expect(screen.getByRole('button').props.accessibilityLabel).toBe('Attach')
    })
})

describeOnAndroid('NativeMenu rows on Android', () => {
    it('gives a single-line row the height of an iOS menu row, and lets a row with a subtitle grow', async () => {
        await render(
            <NativeMenu label="Account" trigger={<Text>Me</Text>}>
                <MenuItem label="Preferences" icon="settings" onPress={() => {}} />
                <MenuItem label="CV to send" subtitle="Which CV should I send?" onPress={() => {}} />
            </NativeMenu>,
        )
        await fireEvent.press(screen.getByRole('button', { name: 'Account' }))
        expect(modifiersOf('Preferences')).toEqual([{ height: 44 }])
        expect(modifiersOf('CV to send Which CV should I send?')).toEqual([])
    })

    it('lines a row without an icon up with the rows that have one', async () => {
        await render(
            <NativeMenu label="Chat" trigger={<Text>Chat</Text>}>
                <SubMenu label="Conversations">
                    <MenuToggle label="Plan the launch" isOn onChange={() => {}} />
                </SubMenu>
                {false}
                <>
                    <MenuItem label="Details" icon="info" onPress={() => {}} />
                </>
            </NativeMenu>,
        )
        await fireEvent.press(screen.getByRole('button', { name: 'Chat' }))
        expect(screen.getAllByTestId('menu-icon-space')).toHaveLength(1)
    })

    it('keeps no empty icon column in a menu without icons', async () => {
        await render(
            <NativeMenu label="Coworker" trigger={<Text>To</Text>}>
                <MenuToggle label="Scout" isOn onChange={() => {}} />
                <MenuToggle label="Writer" isOn={false} onChange={() => {}} />
            </NativeMenu>,
        )
        await fireEvent.press(screen.getByRole('button', { name: 'Coworker' }))
        expect(screen.queryByTestId('menu-icon-space')).toBeNull()
    })

    it('indents the rows a submenu unfolds', async () => {
        await render(
            <NativeMenu label="Account" trigger={<Text>Me</Text>}>
                <SubMenu label="Workspaces" icon="layers">
                    <MenuToggle label="Acme" badge={{ initials: 'A' }} isOn onChange={() => {}} />
                </SubMenu>
                <MenuItem label="Preferences" icon="settings" onPress={() => {}} />
            </NativeMenu>,
        )
        await fireEvent.press(screen.getByRole('button', { name: 'Account' }))
        await fireEvent.press(screen.getByText('Workspaces'))
        expect(modifiersOf(/Acme/)).toEqual([{ height: 44 }, { paddingStart: 16 }])
        expect(modifiersOf('Preferences')).toEqual([{ height: 44 }])
    })
})

describeOnAndroid('LongPressMenu on Android', () => {
    it('opens on a tap, shows its menu on a long press', async () => {
        const onOpen = jest.fn()
        const onUnpin = jest.fn()
        await render(
            <LongPressMenu label="Scout" onPress={onOpen} items={<MenuItem label="Unpin" icon="pin-off" onPress={onUnpin} />}>
                <Text>Scout</Text>
            </LongPressMenu>,
        )
        const cell = screen.getByRole('button', { name: 'Scout' })
        await fireEvent.press(cell)
        expect(onOpen).toHaveBeenCalledTimes(1)
        expect(screen.queryByText('Unpin')).toBeNull()
        await fireEvent(cell, 'longPress')
        await fireEvent.press(screen.getByText('Unpin'))
        expect(onUnpin).toHaveBeenCalledTimes(1)
    })
})
