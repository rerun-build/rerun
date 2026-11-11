import type { SkillSummary } from '@rerun/contracts'
import { ActivityIndicator, Pressable, View } from 'react-native'
import { useTranslations } from 'use-intl'

import { AppText } from '@/components/ui/AppText'
import { CoworkerAvatar } from '@/components/ui/CoworkerAvatar'
import { Icon, type IconName } from '@/components/ui/Icon'
import { MenuItem, MenuToggle, NativeMenu, SubMenu } from '@/components/ui/NativeMenu'
import { ProviderLogo } from '@/components/ui/ProviderLogo'
import type { Coworker } from '@/mocks/data'
import type { Model } from '@/mocks/models'
import { ctaRelief } from '@/theme/relief'
import { useTheme } from '@/theme/theme'
import { spacing } from '@/theme/tokens'

export const CONTROL = 36

// `busy` keeps the button's shape and colour while its action is under way, the glyph a spinner.
export function RoundButton({ symbol, label, onPress, tone = 'muted', disabled: disabledProp, busy = false }: { symbol: IconName; label: string; onPress: () => void; tone?: 'primary' | 'muted' | 'plain'; disabled?: boolean; busy?: boolean }) {
    const theme = useTheme()
    const disabled = disabledProp || busy
    const lit = tone === 'primary' && (!disabled || busy)
    const background = lit ? theme.primary : tone === 'plain' ? 'transparent' : theme.muted
    const tint = lit ? theme.primaryForeground : disabled ? theme.mutedForeground : theme.foreground
    return (
        <Pressable
            onPress={onPress}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ disabled, busy }}
            hitSlop={6}
            style={({ pressed }) => ({
                width: CONTROL,
                height: CONTROL,
                borderRadius: CONTROL / 2,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: background,
                opacity: pressed && tone !== 'primary' ? 0.6 : 1,
                boxShadow: lit ? ctaRelief[theme.scheme][pressed ? 'pressed' : 'rest'] : undefined,
            })}
        >
            {busy ? <ActivityIndicator size="small" color={tint} /> : <Icon name={symbol} size={tone === 'plain' ? 20 : 15} bold={tone === 'primary'} color={tint} />}
        </Pressable>
    )
}

export function AttachMenu({ onPhotos, onCamera, onFiles, skills = [], onSkill, disabled = false }: { onPhotos: () => void; onCamera: () => void; onFiles: () => void; skills?: SkillSummary[]; onSkill?: (slug: string) => void; disabled?: boolean }) {
    const theme = useTheme()
    const t = useTranslations('mobileChat.composer')
    const trigger = (
        <View accessibilityLabel={t('attach')} accessibilityState={{ disabled }} style={{ width: CONTROL, height: CONTROL, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="plus" size={20} color={disabled ? theme.mutedForeground : theme.foreground} />
        </View>
    )
    // The menu is a SwiftUI host with no disabled state of its own: the bare trigger is drawn instead.
    if (disabled) return trigger
    // Sized here: Android's menu host is measured by Compose a frame late, and until then it stretched
    // the composer's row to twice its height.
    return (
        <View style={{ width: CONTROL, height: CONTROL }}>
            <NativeMenu trigger={trigger}>
                <MenuItem label={t('photos')} icon="images" onPress={onPhotos} />
                <MenuItem label={t('camera')} icon="camera" onPress={onCamera} />
                <MenuItem label={t('files')} icon="folder" onPress={onFiles} />
                {skills.length > 0 && onSkill && (
                    <SubMenu label={t('skills')} icon="book">
                        {skills.map(skill => (
                            <MenuItem key={skill.slug} label={skill.name} onPress={() => onSkill(skill.slug)} />
                        ))}
                    </SubMenu>
                )}
            </NativeMenu>
        </View>
    )
}

export function ModelChip({ model, onPress }: { model: Model; onPress: () => void }) {
    const t = useTranslations('mobileChat.composer')
    return (
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={t('modelLabel', { model: model.label })} hitSlop={6} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, height: CONTROL, paddingHorizontal: spacing.sm, flexShrink: 1, opacity: pressed ? 0.6 : 1 })}>
            <ProviderLogo provider={model.provider} size={15} />
            <AppText variant="callout" numberOfLines={1} maxFontSizeMultiplier={1.2} style={{ flexShrink: 1 }}>
                {model.label}
            </AppText>
        </Pressable>
    )
}

// Who a new chat goes to, picked before the first message like the repo of a Conductor workspace.
export function TargetPicker({ target, choices, onPick }: { target: Coworker; choices: Coworker[]; onPick: (id: string) => void }) {
    const theme = useTheme()
    const t = useTranslations('mobileChat.composer')
    return (
        <NativeMenu
            trigger={
                <View accessibilityLabel={t('sendTo', { name: target.name })} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 }}>
                    <CoworkerAvatar coworker={target} size={18} facing="right" animated={false} />
                    <AppText variant="footnote" tone="muted" medium numberOfLines={1} maxFontSizeMultiplier={1.2}>
                        {target.name}
                    </AppText>
                    <Icon name="chevron-down" size={10} bold color={theme.mutedForeground} />
                </View>
            }
        >
            {choices.map(coworker => (
                <MenuToggle key={coworker.id} label={coworker.name} isOn={coworker.id === target.id} onChange={() => onPick(coworker.id)} />
            ))}
        </NativeMenu>
    )
}
