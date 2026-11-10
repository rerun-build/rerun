import * as Clipboard from 'expo-clipboard'
import * as WebBrowser from 'expo-web-browser'
import { useState, type ReactNode } from 'react'
import { ActivityIndicator, Pressable, View } from 'react-native'
import { useTranslations } from 'use-intl'

import { AppText } from '@/components/ui/AppText'
import { TONES } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { ProviderLogo } from '@/components/ui/ProviderLogo'
import { TextField } from '@/components/ui/TextField'
import { useTheme } from '@/theme/theme'
import { fonts, radius, spacing } from '@/theme/tokens'

import { ErrorLine, SheetFrame, StepTrack, type TrackStep } from './bits'

// Same constants as apps/ui/components/connections/plan-connect/chatgpt-setup.ts.
export const CHATGPT_SECURITY_URL = 'https://chatgpt.com/#settings/Security'
// ChatGPT's own labels, as its English settings show them.
const SETTING_PATH = ['Settings', 'Security', 'Enable device code authorization for Codex']

// Adding a plan ends on its name; signing one in again ends on the coworkers starting again.
export type SignInEnding = { kind: 'name'; name: string; placeholder: string; onName: (name: string) => void; onDone: () => void; saving: boolean; error: string | null } | { kind: 'reconnect' }

type EndingTranslator = ReturnType<typeof useTranslations<'mobileProviders.ending'>>

function lastStep(ending: SignInEnding, linked: boolean, t: EndingTranslator): TrackStep {
    if (ending.kind === 'reconnect') return { title: t('coworkersStart') }
    const canFinish = linked && !ending.saving && ending.name.trim() !== ''
    return {
        title: t('nameIt'),
        body: (
            <View style={{ gap: spacing.sm }}>
                <TextField id="connection-name" label={t('connectionName')} help={t('nameHelp')} value={ending.name} onChangeText={ending.onName} placeholder={ending.placeholder} />
                <View style={{ alignSelf: 'flex-start' }}>
                    <Button label={ending.saving ? t('saving') : t('done')} onPress={ending.onDone} disabled={!canFinish} loading={ending.saving} />
                </View>
                <ErrorLine error={ending.error} />
            </View>
        ),
    }
}

export type ClaudePhase = 'idle' | 'waiting' | 'checking' | 'connected'

type ClaudeSignInProps = {
    phase: ClaudePhase
    error: string | null
    code: string
    onCode: (code: string) => void
    onOpenClaude: () => void
    onPaste: () => void
    onSubmit: () => void
    ending: SignInEnding
    onBack: () => void
}

// The web's ClaudePlanSteps: approve on Claude, paste back what it shows. The field also takes a
// `claude setup-token` token pasted by hand.
export function ClaudeSignIn({ phase, error, code, onCode, onOpenClaude, onPaste, onSubmit, ending, onBack }: ClaudeSignInProps) {
    const opened = phase !== 'idle'
    const busy = phase === 'checking'
    const linked = phase === 'connected'
    const t = useTranslations('mobileProviders.claude')
    const tEnding = useTranslations('mobileProviders.ending')
    return (
        <SheetFrame title="Claude" onBack={onBack}>
            <StepTrack
                at={linked ? 2 : opened ? 1 : 0}
                done={linked ? 3 : opened ? 1 : 0}
                steps={[
                    {
                        title: t('approve'),
                        body: (
                            <View style={{ alignSelf: 'flex-start' }}>
                                <Button label={opened ? t('openAgain') : t('open')} variant={opened ? 'outline' : 'default'} icon={<ProviderLogo provider="claude" size={16} />} onPress={onOpenClaude} disabled={busy || linked} />
                            </View>
                        ),
                    },
                    {
                        title: t('pasteStep'),
                        body: (
                            <View style={{ gap: spacing.sm }}>
                                <TextField id="claude-code" label={t('codeLabel')} value={code} onChangeText={onCode} placeholder={busy ? t('checking') : t('codeLabel')} secret />
                                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                                    <Button label={t('paste')} symbol="clipboard-paste" variant={code.trim() ? 'outline' : 'default'} onPress={onPaste} disabled={busy} />
                                    {code.trim() !== '' && <Button label={t('connect')} onPress={onSubmit} loading={busy} />}
                                </View>
                                <ErrorLine error={error} />
                            </View>
                        ),
                    },
                    lastStep(ending, linked, tEnding),
                ]}
            />
        </SheetFrame>
    )
}

export type ChatGptPhase = 'idle' | 'starting' | 'waiting' | 'connected'

type ChatGptSignInProps = {
    phase: ChatGptPhase
    pending: { userCode: string; verificationUrl: string } | null
    expired: boolean
    stuck: boolean
    error: string | null
    onGetCode: () => void
    // Called as OpenAI's page opens, before the browser covers the code.
    onOpenVerification?: () => void
    ending: SignInEnding
    onBack: () => void
}

// The web's ChatGptPlanSteps. OpenAI only takes the device code once the account allows it, and
// nothing says it is off: the approval just never comes. So the switch comes first.
export function ChatGptSignIn({ phase, pending, expired, stuck, error, onGetCode, onOpenVerification, ending, onBack }: ChatGptSignInProps) {
    const [settingsOpened, setSettingsOpened] = useState(false)
    const [workspacePlan, setWorkspacePlan] = useState(false)
    const linked = phase === 'connected'
    const onCode = settingsOpened || phase !== 'idle' || expired || error !== null
    const t = useTranslations('mobileProviders.chatgpt')
    const tEnding = useTranslations('mobileProviders.ending')

    const openSettings = () => {
        setSettingsOpened(true)
        WebBrowser.openBrowserAsync(CHATGPT_SECURITY_URL)
    }

    return (
        <SheetFrame title="ChatGPT" onBack={onBack}>
            <StepTrack
                at={linked ? 2 : onCode ? 1 : 0}
                done={linked ? 3 : onCode ? 1 : 0}
                steps={[
                    {
                        title: t('allowStep'),
                        body: (
                            <View style={{ gap: spacing.md }}>
                                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                                    <Button label={t('openSettings')} symbol="arrow-up-right" onPress={openSettings} />
                                    <Button label={t('alreadyOn')} symbol="check" variant="outline" onPress={onGetCode} />
                                </View>
                                {workspacePlan ? (
                                    <AppText variant="footnote" tone="muted">
                                        {t('adminSwitches')} <CopyAdminMessage />
                                    </AppText>
                                ) : (
                                    <SettingPath />
                                )}
                                <AppText variant="footnote" tone="muted" style={{ textDecorationLine: 'underline' }} onPress={() => setWorkspacePlan(value => !value)}>
                                    {workspacePlan ? t('onPlusOrPro') : t('onBusiness')}
                                </AppText>
                            </View>
                        ),
                    },
                    { title: t('enterStep'), body: <CodeStep phase={phase} pending={pending} expired={expired} stuck={stuck} error={error} workspacePlan={workspacePlan} onGetCode={onGetCode} onOpenVerification={onOpenVerification} /> },
                    lastStep(ending, linked, tEnding),
                ]}
            />
        </SheetFrame>
    )
}

function SettingPath() {
    const theme = useTheme()
    return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs }}>
            {SETTING_PATH.map((segment, index) => (
                <View key={segment} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, maxWidth: '100%' }}>
                    {index > 0 && <Icon name="chevron-right" size={10} bold color={theme.mutedForeground} />}
                    <View style={{ flexShrink: 1, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: theme.muted }}>
                        <AppText variant="caption" medium={index === SETTING_PATH.length - 1} tone={index === SETTING_PATH.length - 1 ? 'default' : 'muted'}>
                            {segment}
                        </AppText>
                    </View>
                </View>
            ))}
        </View>
    )
}

function CopyAdminMessage() {
    const t = useTranslations('mobileProviders.chatgpt')
    const [copied, setCopied] = useState(false)
    const copy = () => {
        Clipboard.setStringAsync(t('adminMessage'))
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }
    return (
        <AppText variant="footnote" medium onPress={copy} style={{ textDecorationLine: 'underline' }}>
            {copied ? t('copied') : t('copyAdminMessage')}
        </AppText>
    )
}

type CodeStepProps = { phase: ChatGptPhase; pending: ChatGptSignInProps['pending']; expired: boolean; stuck: boolean; error: string | null; workspacePlan: boolean; onGetCode: () => void; onOpenVerification?: () => void }

function CodeStep({ phase, pending, expired, stuck, error, workspacePlan, onGetCode, onOpenVerification }: CodeStepProps) {
    const theme = useTheme()
    const t = useTranslations('mobileProviders.chatgpt')
    const [copied, setCopied] = useState(false)
    if (phase === 'connected') return null

    const copy = () => {
        if (!pending) return
        Clipboard.setStringAsync(pending.userCode)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    return (
        <View style={{ gap: spacing.md }}>
            {pending && !expired ? (
                <>
                    <Pressable onPress={copy} accessibilityRole="button" accessibilityLabel={t('copyCode')} testID="codex-code" style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.md, borderCurve: 'continuous', paddingVertical: spacing.md, paddingLeft: spacing.lg, paddingRight: spacing.md, backgroundColor: pressed ? theme.secondary : theme.muted })}>
                        <AppText numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.2} style={{ flex: 1, fontFamily: fonts.mono, fontSize: 22, lineHeight: 28, letterSpacing: 4, color: theme.foreground }}>
                            {pending.userCode}
                        </AppText>
                        <Icon name={copied ? 'check' : 'copy'} size={17} color={theme.foreground} />
                    </Pressable>
                    <View style={{ alignSelf: 'flex-start' }}>
                        <Button label={t('openOpenAI')} icon={<ProviderLogo provider="codex" size={16} color={theme.primaryForeground} />} onPress={() => {
                                onOpenVerification?.()
                                WebBrowser.openBrowserAsync(pending.verificationUrl)
                            }}
                        />
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                        <ActivityIndicator size="small" color={theme.mutedForeground} />
                        <AppText variant="footnote" tone="muted" style={{ flex: 1 }}>
                            {t('enterHint')}
                        </AppText>
                    </View>
                </>
            ) : (
                <View style={{ alignSelf: 'flex-start' }}>
                    <Button label={phase === 'starting' ? t('gettingCode') : expired ? t('getNewCode') : t('getCode')} icon={<ProviderLogo provider="codex" size={16} color={theme.primaryForeground} />} onPress={onGetCode} loading={phase === 'starting'} />
                </View>
            )}
            {stuck ? <StuckHint expired={expired} workspacePlan={workspacePlan} /> : <ErrorLine error={error} />}
        </View>
    )
}

function StuckHint({ expired, workspacePlan }: { expired: boolean; workspacePlan: boolean }) {
    const theme = useTheme()
    const t = useTranslations('mobileProviders.chatgpt.stuck')
    const settingsLink = (chunks: ReactNode) => (
        <AppText variant="footnote" medium style={{ textDecorationLine: 'underline' }} onPress={() => WebBrowser.openBrowserAsync(CHATGPT_SECURITY_URL)}>
            {chunks}
        </AppText>
    )
    return (
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Icon name="triangle-alert" size={14} color={TONES.yellow[theme.scheme]} style={{ marginTop: 2 }} />
            <AppText variant="footnote" tone="muted" style={{ flex: 1 }}>
                {workspacePlan ? (
                    <>
                        {expired ? t('expiredAdmin') : t('errorAdmin')} <CopyAdminMessage />
                    </>
                ) : expired ? (
                    t.rich('expiredSetting', { link: settingsLink })
                ) : (
                    t.rich('errorSetting', { link: settingsLink })
                )}
            </AppText>
        </View>
    )
}
