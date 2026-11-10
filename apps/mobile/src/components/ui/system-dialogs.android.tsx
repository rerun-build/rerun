import { useRef, useState, useSyncExternalStore } from 'react'
import { Modal, Pressable, StyleSheet, TextInput, View, type TextInputInstance } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { AppText } from '@/components/ui/AppText'
import type { ActionSheetRequest, TextPromptRequest } from '@/components/ui/dialog-types'
import { translatorFor } from '@/i18n/translator'
import { fieldOutline } from '@/theme/field'
import { useTheme } from '@/theme/theme'
import { brand, controlSize, fonts, radius, spacing, withAlpha } from '@/theme/tokens'

export type { ActionSheetRequest, TextPromptRequest } from '@/components/ui/dialog-types'

type Shown = { kind: 'sheet'; request: ActionSheetRequest; onSelect: (index: number) => void } | { kind: 'prompt'; request: TextPromptRequest; opening: number }

let shown: Shown | null = null
let openings = 0
const listeners = new Set<() => void>()

function show(next: Shown | null) {
    shown = next
    listeners.forEach(listener => listener())
}

function subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

// iOS's action sheet on Android: a bottom sheet of rows, dismissed by the back gesture or a tap
// outside, which answers the cancel index as iOS does.
export function showActionSheet(request: ActionSheetRequest, onSelect: (index: number) => void): void {
    show({ kind: 'sheet', request, onSelect })
}

// iOS's Alert.prompt, which Android does not have: a dialog with one text field.
export function promptText(request: TextPromptRequest): void {
    openings += 1
    show({ kind: 'prompt', request, opening: openings })
}

const GRABBER = { width: 36, height: 4 }
const ROW_HEIGHT = 52
const DIALOG_MAX_WIDTH = 420
const KEYBOARD_DELAY_MS = 250

function ActionSheet({ request, onSelect }: { request: ActionSheetRequest; onSelect: (index: number) => void }) {
    const theme = useTheme()
    const insets = useSafeAreaInsets()
    const answer = (index: number) => {
        show(null)
        onSelect(index)
    }
    const cancel = () => answer(request.cancelButtonIndex)
    return (
        <Modal visible transparent animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={cancel}>
            <Pressable testID="action-sheet-backdrop" accessibilityLabel={translatorFor('mobileCommon')('actions.close')} onPress={cancel} style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.4)' }]} />
            <View style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
                <View accessibilityViewIsModal style={{ backgroundColor: theme.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, borderBottomWidth: 0, borderColor: theme.border, paddingTop: spacing.sm, paddingBottom: insets.bottom + spacing.sm }}>
                    <View style={{ alignSelf: 'center', ...GRABBER, borderRadius: GRABBER.height / 2, backgroundColor: withAlpha(theme.mutedForeground, 0.4), marginBottom: spacing.sm }} />
                    {request.title || request.message ? (
                        <View style={{ paddingHorizontal: spacing.xl, paddingVertical: spacing.sm, gap: 2 }}>
                            {request.title ? (
                                <AppText variant="footnote" medium tone="muted">
                                    {request.title}
                                </AppText>
                            ) : null}
                            {request.message ? (
                                <AppText variant="footnote" tone="muted">
                                    {request.message}
                                </AppText>
                            ) : null}
                        </View>
                    ) : null}
                    {request.options.map((label, index) =>
                        index === request.cancelButtonIndex ? null : (
                            <Pressable key={`${index}-${label}`} onPress={() => answer(index)} accessibilityRole="button" android_ripple={{ color: withAlpha(theme.foreground, 0.08) }} style={{ minHeight: ROW_HEIGHT, justifyContent: 'center', paddingHorizontal: spacing.xl }}>
                                <AppText variant="body" tone={index === request.destructiveButtonIndex ? 'destructive' : 'default'} numberOfLines={2}>
                                    {label}
                                </AppText>
                            </Pressable>
                        )
                    )}
                </View>
            </View>
        </Modal>
    )
}

function TextPrompt({ request }: { request: TextPromptRequest }) {
    const theme = useTheme()
    const [text, setText] = useState(request.defaultValue ?? '')
    const [focused, setFocused] = useState(false)
    const input = useRef<TextInputInstance>(null)
    const t = translatorFor('mobileCommon')
    const cancel = () => {
        show(null)
        request.onCancel?.()
    }
    const submit = () => {
        show(null)
        request.onSubmit(text)
    }
    return (
        // The keyboard only opens once the modal's window has the focus, a moment after it shows: autoFocus,
        // or a focus right on onShow, leaves the field focused with the keyboard closed.
        <Modal visible transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={cancel} onShow={() => setTimeout(() => input.current?.focus(), KEYBOARD_DELAY_MS)}>
            <Pressable testID="prompt-backdrop" accessibilityLabel={request.cancelLabel ?? t('actions.cancel')} onPress={cancel} style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.4)' }]} />
            <View style={{ flex: 1, alignItems: 'center', paddingTop: '28%', paddingHorizontal: spacing.xl }} pointerEvents="box-none">
                <View accessibilityViewIsModal style={{ width: '100%', maxWidth: DIALOG_MAX_WIDTH, backgroundColor: theme.card, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border, padding: spacing.xl, gap: spacing.md }}>
                    <AppText variant="headline" accessibilityRole="header">
                        {request.title}
                    </AppText>
                    {request.message ? (
                        <AppText variant="footnote" tone="muted">
                            {request.message}
                        </AppText>
                    ) : null}
                    <TextInput
                        ref={input}
                        testID="prompt-input"
                        value={text}
                        onChangeText={setText}
                        selectTextOnFocus
                        accessibilityLabel={request.title}
                        onSubmitEditing={submit}
                        returnKeyType="done"
                        onFocus={() => setFocused(true)}
                        onBlur={() => setFocused(false)}
                        placeholderTextColor={theme.mutedForeground}
                        style={{ minHeight: controlSize.md.height, paddingHorizontal: spacing.md, borderRadius: controlSize.md.radius, ...fieldOutline(theme, { focused }), backgroundColor: theme.background, color: theme.foreground, fontFamily: fonts.regular, fontSize: 16 }}
                    />
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing.xs, marginTop: spacing.xs }}>
                        <DialogButton label={request.cancelLabel ?? t('actions.cancel')} color={theme.mutedForeground} onPress={cancel} />
                        <DialogButton label={request.submitLabel ?? t('actions.done')} color={theme.scheme === 'dark' ? brand.soft : brand.base} onPress={submit} />
                    </View>
                </View>
            </View>
        </Modal>
    )
}

function DialogButton({ label, color, onPress }: { label: string; color: string; onPress: () => void }) {
    return (
        <Pressable onPress={onPress} accessibilityRole="button" android_ripple={{ color: withAlpha(color, 0.16) }} style={{ minHeight: controlSize.md.height, minWidth: 64, paddingHorizontal: spacing.md, borderRadius: controlSize.md.radius, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
            <AppText variant="callout" medium style={{ color }}>
                {label}
            </AppText>
        </Pressable>
    )
}

export function SystemDialogHost() {
    const current = useSyncExternalStore(subscribe, () => shown)
    if (!current) return null
    if (current.kind === 'sheet') return <ActionSheet request={current.request} onSelect={current.onSelect} />
    return <TextPrompt key={current.opening} request={current.request} />
}
