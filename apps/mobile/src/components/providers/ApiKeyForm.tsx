import type { AiConnectionsView } from '@rerun/contracts'
import { SymbolView } from 'expo-symbols'
import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { useTranslations } from 'use-intl'

import { AppText } from '@/components/ui/AppText'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/GroupedList'
import { TextField } from '@/components/ui/TextField'
import { useTheme } from '@/theme/theme'
import { spacing } from '@/theme/tokens'

import { ErrorLine, GuideSteps, LogoTile, SheetFrame } from './bits'

type ApiKeyFormProps = {
    entry: AiConnectionsView['addable'][number]
    name: string
    onName: (name: string) => void
    apiKey: string
    onApiKey: (key: string) => void
    baseUrl: string
    onBaseUrl: (url: string) => void
    busy: boolean
    error: string | null
    onConnect: () => void
    onBack: () => void
}

// The web's AddProviderPage for a key: a name, the key, its guide folded under it. OpenRouter also
// takes the base URL of a router of the user's own.
export function ApiKeyForm({ entry, name, onName, apiKey, onApiKey, baseUrl, onBaseUrl, busy, error, onConnect, onBack }: ApiKeyFormProps) {
    const theme = useTheme()
    const [guideOpen, setGuideOpen] = useState(false)
    const t = useTranslations('mobileProviders.apiKey')
    const tBaseUrl = useTranslations('mobileProviders.baseUrl')
    return (
        <SheetFrame title={entry.title} onBack={onBack}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <LogoTile provider={entry.provider} />
                <AppText variant="callout" tone="muted" style={{ flex: 1 }}>
                    {entry.hint}
                </AppText>
            </View>

            <View style={{ gap: spacing.lg }}>
                <TextField id="connection-name" label={t('name')} value={name} onChangeText={onName} placeholder={entry.suggestedName} />
                <TextField id="api-key" label={t('keyLabel')} value={apiKey} onChangeText={onApiKey} placeholder={t('keyPlaceholder')} secret />
                {entry.provider === 'openrouter' && <TextField id="base-url" label={tBaseUrl('label')} help={tBaseUrl('help')} value={baseUrl} onChangeText={onBaseUrl} placeholder="https://router.example.com/api/v1" verbatim />}
            </View>

            {entry.guide && (
                <Card>
                    <Pressable onPress={() => setGuideOpen(open => !open)} accessibilityRole="button" accessibilityState={{ expanded: guideOpen }} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.lg }}>
                        <AppText variant="callout" medium style={{ flex: 1 }}>
                            {entry.guide.title}
                        </AppText>
                        <SymbolView name={guideOpen ? 'chevron.up' : 'chevron.down'} size={12} weight="semibold" tintColor={theme.mutedForeground} />
                    </Pressable>
                    {guideOpen && (
                        <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }}>
                            <GuideSteps steps={entry.guide.steps} />
                        </View>
                    )}
                </Card>
            )}

            <View style={{ gap: spacing.sm }}>
                <Button label={t('connect')} size="lg" onPress={onConnect} disabled={!apiKey.trim() || !name.trim()} loading={busy} />
                <ErrorLine error={error} />
            </View>
        </SheetFrame>
    )
}
