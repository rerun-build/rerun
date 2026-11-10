import type { AiConnectionsView, ModelChoice } from '@rerun/contracts'
import { Fragment } from 'react'
import { View } from 'react-native'
import { useTranslations } from 'use-intl'

import { Card, SectionTitle, Separator } from '@/components/ui/GroupedList'
import { ModelRow } from '@/components/ui/ModelRow'
import { ProviderLogo } from '@/components/ui/ProviderLogo'
import { spacing } from '@/theme/tokens'

import { SheetFrame } from './bits'

// What coworkers with no model of their own run on: every model a ready connection lets them use.
export function DefaultModelPicker({ view, onPick, onBack }: { view: AiConnectionsView; onPick: (choice: ModelChoice) => void; onBack: () => void }) {
    const t = useTranslations('mobileProviders.defaultModel')
    const ready = view.connections.filter(connection => connection.status === 'connected' && connection.models.some(model => model.enabled))
    return (
        <SheetFrame title={t('title')} onBack={onBack}>
            {ready.map(connection => (
                <View key={connection.id} style={{ gap: spacing.sm }}>
                    <SectionTitle>{connection.name}</SectionTitle>
                    <Card>
                        {connection.models
                            .filter(model => model.enabled)
                            .map((model, index) => (
                                <Fragment key={model.id}>
                                    {index > 0 && <Separator inset={spacing.lg + 20 + spacing.md} />}
                                    <ModelRow
                                        id={`default-${connection.id}-${model.id}`}
                                        label={model.label}
                                        description={model.description}
                                        locked={model.locked}
                                        selected={view.default.connectionId === connection.id && view.default.model === model.id}
                                        leading={<ProviderLogo provider={connection.provider} size={18} />}
                                        onPress={() => onPick({ connectionId: connection.id, model: model.id })}
                                    />
                                </Fragment>
                            ))}
                    </Card>
                </View>
            ))}
        </SheetFrame>
    )
}
