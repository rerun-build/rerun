import { INTAKE_INDUSTRIES, rolesForIndustry } from '@rerun/contracts'
import { useState } from 'react'
import { ScrollView, TextInput, View } from 'react-native'
import Animated, { FadeIn, useAnimatedStyle } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslations } from 'use-intl'

import { AnswerInput, CustomOptionRow, OptionRow } from '@/components/chat/hitl/QuestionWidget'
import { FORM_COLUMN_MAX_WIDTH } from '@/components/layout/split'
import { ForemanOrb } from '@/components/orb/ForemanOrb'
import { AppText } from '@/components/ui/AppText'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { useKeyboardHeight } from '@/lib/keyboard-height'
import { fieldOutline } from '@/theme/field'
import { useTheme } from '@/theme/theme'
import { controlSize, fonts, radius, spacing, withAlpha } from '@/theme/tokens'

import type { IntakeController } from './useIntake'

function StepDots({ count, index }: { count: number; index: number }) {
    const theme = useTheme()
    const t = useTranslations('mobileOnboarding')
    return (
        <View style={{ flexDirection: 'row', gap: 6 }} accessibilityLabel={t('intake.progress', { current: index + 1, total: count })}>
            {Array.from({ length: count }, (_, at) => (
                <View key={at} style={{ width: at === index ? 18 : 6, height: 6, borderRadius: 3, backgroundColor: at <= index ? theme.foreground : withAlpha(theme.mutedForeground, 0.35) }} />
            ))}
        </View>
    )
}

function SiteField({ value, onChangeText, onSubmit, disabled }: { value: string; onChangeText: (text: string) => void; onSubmit: () => void; disabled: boolean }) {
    const theme = useTheme()
    const [focused, setFocused] = useState(false)
    const t = useTranslations('mobileOnboarding')
    return <TextInput value={value} onChangeText={onChangeText} onSubmitEditing={onSubmit} editable={!disabled} autoFocus autoCapitalize="none" autoCorrect={false} keyboardType="url" textContentType="URL" returnKeyType="next" placeholder={t('intake.website.placeholder')} placeholderTextColor={theme.mutedForeground} accessibilityLabel={t('intake.website.label')} testID="intake-site" onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} style={{ height: controlSize.lg.height, paddingHorizontal: spacing.lg, borderRadius: radius.md, borderCurve: 'continuous', ...fieldOutline(theme, { focused }), backgroundColor: theme.card, color: theme.foreground, fontFamily: fonts.regular, fontSize: 17 }} />
}

// A list of answers with a free one under it, the web card's: picking answers the step on the spot.
function Choices({ options, value, typed, placeholder, onPick, onType, onSubmit }: { options: string[]; value: string | null; typed: string; placeholder: string; onPick: (option: string) => void; onType: (text: string) => void; onSubmit: () => void }) {
    const [open, setOpen] = useState(typed.length > 0)
    return (
        <View style={{ gap: spacing.sm }}>
            {options.map((option, position) => (
                <OptionRow key={option} index={position} label={option} selected={!open && value === option} multiple={false} onPress={() => onPick(option)} />
            ))}
            <CustomOptionRow open={open} onOpen={() => setOpen(true)}>
                <AnswerInput value={typed} onChangeText={onType} onSubmit={onSubmit} placeholder={placeholder} last autoFocus />
            </CustomOptionRow>
        </View>
    )
}

// The rows of the role question while its industry is still being guessed: the same rows, so nothing
// moves once they arrive.
function ChoicesSkeleton() {
    return (
        <View style={{ gap: spacing.sm }}>
            {[0, 1, 2, 3, 4].map(row => (
                <Skeleton key={row} style={{ height: 48, borderRadius: radius.md }} />
            ))}
        </View>
    )
}

// The welcome card, asked by the app itself before the assistant says anything, as on the web: a
// question, the line that says why, and the answers under it.
export function IntakeView({ intake }: { intake: IntakeController }) {
    const theme = useTheme()
    const insets = useSafeAreaInsets()
    const keyboard = useKeyboardHeight()
    const t = useTranslations('mobileOnboarding')
    const lift = useAnimatedStyle(() => ({ paddingBottom: Math.max(keyboard.height.value, insets.bottom) + spacing.md }))
    const { step, steps, index, draft, industry, deciding, submitting, saveFailed, canAdvance, last, set, choose, next, back, skipWebsite } = intake
    const industries = INTAKE_INDUSTRIES.map(option => ({ value: option.value, label: t(`intake.industries.${option.value}`) }))
    const skippable = step === 'company' && !draft.companyUrl.trim()
    const roles = rolesForIndustry(industry)

    return (
        <Animated.View style={[{ flex: 1, width: '100%', maxWidth: FORM_COLUMN_MAX_WIDTH, alignSelf: 'center' }, lift]}>
            <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={{ flexGrow: 1, paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.xl, gap: spacing.xl }}>
                <View style={{ gap: spacing.lg }}>
                    <ForemanOrb size={48} state={submitting ? 'thinking' : 'idle'} />
                    <StepDots count={steps.length} index={index} />
                    <Animated.View key={step} entering={FadeIn.duration(200)} style={{ gap: spacing.xs }}>
                        <AppText variant="title">{t(`intake.steps.${step}.title`)}</AppText>
                        <AppText variant="callout" tone="muted">
                            {t(`intake.steps.${step}.description`)}
                        </AppText>
                    </Animated.View>
                </View>

                <Animated.View key={`${step}-body`} entering={FadeIn.duration(200)}>
                    {step === 'company' && <SiteField value={draft.companyUrl} onChangeText={companyUrl => set({ companyUrl })} onSubmit={() => next()} disabled={submitting} />}
                    {step === 'industry' && <Choices options={industries.map(option => option.label)} value={industries.find(option => option.value === draft.industry)?.label ?? null} typed={draft.industryLabel} placeholder={t('intake.industry.placeholder')} onPick={label => choose({ industry: industries.find(option => option.label === label)?.value ?? null, industryLabel: '' })} onType={industryLabel => set({ industryLabel, industry: null })} onSubmit={() => next()} />}
                    {step === 'role' && deciding && <ChoicesSkeleton />}
                    {step === 'role' && !deciding && <Choices options={roles} value={roles.includes(draft.position) ? draft.position : null} typed={roles.includes(draft.position) ? '' : draft.position} placeholder={t('intake.role.placeholder')} onPick={position => choose({ position })} onType={position => set({ position })} onSubmit={() => next()} />}
                    {step === 'name' && <AnswerInput value={draft.firstName} onChangeText={firstName => set({ firstName })} onSubmit={() => next()} placeholder={t('intake.name.placeholder')} last autoFocus />}
                </Animated.View>

                {saveFailed && (
                    <AppText variant="footnote" style={{ color: theme.destructive }}>
                        {t('intake.saveFailed')}
                    </AppText>
                )}
            </ScrollView>

            <View style={{ flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.xl }}>
                {index > 0 && <Button label={t('intake.back')} variant="ghost" size="lg" onPress={back} disabled={submitting} />}
                <View style={{ flex: 1 }}>{skippable ? <Button label={t('intake.website.none')} variant="outline" size="lg" onPress={skipWebsite} /> : <Button label={last ? t('intake.continue') : t('intake.next')} size="lg" onPress={() => next()} disabled={!canAdvance} loading={submitting} />}</View>
            </View>
        </Animated.View>
    )
}
