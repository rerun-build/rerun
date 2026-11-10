import { CUSTOM_PRESETS, type CustomPreset, type CustomProbeResult } from '@rerun/contracts'
import type { useTranslations } from 'next-intl'

type ConnectionsT = ReturnType<typeof useTranslations<'connections'>>

// A server like Together lists hundreds of models: switching them all on would flood every model
// picker. The rest stay one click away in the connection's hidden list.
export const MODELS_ON_AT_CONNECT = 10

// A cloud machine cannot reach the owner's own computer, so the presets that listen there are only
// offered where the engine runs beside it.
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

// What the form says under the button when the endpoint did not take the connection. Null when it did.
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
