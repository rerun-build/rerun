import * as SecureStore from 'expo-secure-store'
import { useEffect, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslations } from 'use-intl'

import { readSecondStepMethods, spendBackupCode, verifyAppCode, verifyWithPasskey, type SecondStepMethods } from '@/auth/second-step'
import { CodeField } from '@/components/auth/CodeField'
import { StepTitle } from '@/components/auth/steps/StepTitle'
import { TextLink } from '@/components/auth/TextLink'
import { FORM_COLUMN_MAX_WIDTH } from '@/components/layout/split'
import { AppText } from '@/components/ui/AppText'
import { Button } from '@/components/ui/Button'
import { IconTile } from '@/components/ui/IconTile'
import { fieldOutline } from '@/theme/field'
import { useTheme } from '@/theme/theme'
import { controlSize, fonts, spacing } from '@/theme/tokens'

const CODE_LENGTH = 6
// The method this device went through last, offered first next time.
const LAST_METHOD_KEY = 'rerun.two-step.last-method'

type Screen = 'passkey' | 'app' | 'backup'

// The second step of the sign-in, on an account with two-step verification: a passkey on this
// device, the code of the authenticator app, or a backup code. The method last used here leads.
export function SecondFactor({ onSignOut }: { onSignOut: () => void }) {
    const t = useTranslations('mobileAuth.secondStep')
    const theme = useTheme()
    const insets = useSafeAreaInsets()
    const [methods, setMethods] = useState<SecondStepMethods | null>(null)
    const [screen, setScreen] = useState<Screen | null>(null)
    const [code, setCode] = useState('')
    const [backupCode, setBackupCode] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const passkeysHere = methods !== null && methods.hasPasskeys

    useEffect(() => {
        let cancelled = false
        void Promise.all([readSecondStepMethods(), SecureStore.getItemAsync(LAST_METHOD_KEY).catch(() => null)]).then(([read, last]) => {
            if (cancelled) return
            setMethods(read)
            const passkeyFirst = read.hasPasskeys && (last === 'passkey' || !read.appFactorId)
            setScreen(passkeyFirst ? 'passkey' : read.appFactorId ? 'app' : 'backup')
        })
        return () => {
            cancelled = true
        }
    }, [])

    const show = (next: Screen) => {
        setError(null)
        setCode('')
        setBackupCode('')
        setScreen(next)
    }

    // Once the session is raised, the root layout opens the app on its own.
    const remember = (method: 'passkey' | 'app') => SecureStore.setItemAsync(LAST_METHOD_KEY, method).catch(() => {})

    const confirmWithPasskey = async () => {
        if (!methods || busy) return
        setBusy(true)
        setError(null)
        const outcome = await verifyWithPasskey()
        if (outcome === 'ok') {
            await remember('passkey')
            return
        }
        setBusy(false)
        setError(outcome === 'too_many' ? t('backup.tooMany') : t('passkey.failed'))
    }

    const verifyCode = async (value: string) => {
        if (!methods?.appFactorId || busy) return
        setBusy(true)
        setError(null)
        if (await verifyAppCode(methods.appFactorId, value)) {
            await remember('app')
            return
        }
        setBusy(false)
        setCode('')
        setError(t('code.wrong'))
    }

    const verifyBackupCode = async () => {
        if (!backupCode.trim() || busy) return
        setBusy(true)
        setError(null)
        const outcome = await spendBackupCode(backupCode)
        if (outcome === 'ok') return
        setBusy(false)
        setError(outcome === 'too_many' ? t('backup.tooMany') : t('backup.wrong'))
    }

    if (!methods || !screen) {
        return (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}>
                <ActivityIndicator />
            </View>
        )
    }

    const links: { label: string; onPress: () => void }[] = []
    if (screen !== 'app' && methods.appFactorId) links.push({ label: t('useApp'), onPress: () => show('app') })
    if (screen !== 'passkey' && passkeysHere) links.push({ label: t('usePasskey'), onPress: () => show('passkey') })
    if (screen !== 'backup') links.push({ label: t('useBackup'), onPress: () => show('backup') })
    links.push({ label: t('otherAccount'), onPress: onSignOut })

    return (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: theme.background }}>
            <ScrollView
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing.xl, paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }}
            >
                <View style={{ width: '100%', maxWidth: FORM_COLUMN_MAX_WIDTH, alignSelf: 'center', gap: spacing.lg }}>
                    {screen === 'passkey' && (
                        <>
                            <StepTitle title={t('passkey.title')} subtitle={t('passkey.subtitle')} />
                            <View style={{ alignItems: 'center', paddingVertical: spacing.sm }}>
                                <IconTile symbol="shield-check" />
                            </View>
                            <Button label={t('passkey.use')} size="lg" loading={busy} onPress={() => void confirmWithPasskey()} />
                        </>
                    )}
                    {screen === 'app' && (
                        <>
                            <StepTitle title={t('code.title')} subtitle={t('code.subtitle')} />
                            <CodeField length={CODE_LENGTH} value={code} onChangeText={setCode} onComplete={value => void verifyCode(value)} disabled={busy} invalid={Boolean(error)} />
                            <Button label={t('code.verify')} size="lg" loading={busy} disabled={code.length < CODE_LENGTH} onPress={() => void verifyCode(code)} />
                        </>
                    )}
                    {screen === 'backup' && (
                        <>
                            <StepTitle title={t('backup.title')} subtitle={t('backup.subtitle')} />
                            <TextInput
                                value={backupCode}
                                onChangeText={value => {
                                    setBackupCode(value)
                                    setError(null)
                                }}
                                placeholder={t('backup.placeholder')}
                                placeholderTextColor={theme.mutedForeground}
                                autoCapitalize="characters"
                                autoCorrect={false}
                                autoFocus
                                editable={!busy}
                                onSubmitEditing={() => void verifyBackupCode()}
                                style={{
                                    height: controlSize.lg.height,
                                    borderRadius: controlSize.lg.radius,
                                    borderCurve: 'continuous',
                                    ...fieldOutline(theme, { focused: true, invalid: Boolean(error) }),
                                    backgroundColor: theme.card,
                                    color: theme.foreground,
                                    textAlign: 'center',
                                    fontFamily: fonts.mono,
                                    fontSize: 17,
                                    letterSpacing: 2,
                                }}
                            />
                            <Button label={t('backup.verify')} size="lg" loading={busy} disabled={!backupCode.trim()} onPress={() => void verifyBackupCode()} />
                        </>
                    )}
                    {error && (
                        <AppText variant="footnote" tone="destructive" style={{ textAlign: 'center' }}>
                            {error}
                        </AppText>
                    )}
                    <View style={{ alignItems: 'center', gap: spacing.lg, marginTop: spacing.xs }}>
                        {(screen === 'backup' ? [{ label: t('backup.back'), onPress: () => show(passkeysHere ? 'passkey' : methods.appFactorId ? 'app' : 'backup') }, links[links.length - 1]] : links).map(link => (
                            <TextLink key={link.label} label={link.label} onPress={link.onPress} />
                        ))}
                    </View>
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    )
}
