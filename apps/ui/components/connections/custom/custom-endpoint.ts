import { CUSTOM_PRESETS, type CustomPreset, type CustomProbeResult } from '@rerun/contracts'
import type { useTranslations } from 'next-intl'

type ConnectionsT = ReturnType<typeof useTranslations<'connections'>>

export const MODELS_ON_AT_CONNECT = 10

export function presetsFor(cloud: boolean): readonly CustomPreset[] {
    return cloud ? CUSTOM_PRESETS.filter(preset => !preset.local) : CUSTOM_PRESETS
}

function hostOf(baseUrl: string): string {
    try {
        return new URL(baseUrl).host
    } catch {
        return baseUrl
    }
}

export function probeProblemMessage(t: ConnectionsT, result: CustomProbeResult, model: string | undefined, cloud: boolean): string | null {
    switch (result.problem) {
        case null:
            return null
        case 'unreachable':
            return t(cloud ? 'custom.probe.unreachableCloud' : 'custom.probe.unreachableLocal', { host: hostOf(result.baseUrl) })
        case 'unauthorized':
            return t('custom.probe.unauthorized')
        case 'not_listed':
            return t('custom.probe.notListed')
        case 'model_refused':
            if (model) return result.detail ? t('custom.probe.refused', { model, detail: result.detail }) : t('custom.probe.refusedPlain', { model })
            return result.detail ? t('custom.probe.refusedUnnamedDetail', { detail: result.detail }) : t('custom.probe.refusedUnnamed')
    }
}

export function isHttpUrl(value: string): boolean {
    try {
        return /^https?:$/.test(new URL(value.trim()).protocol)
    } catch {
        return false
    }
}
