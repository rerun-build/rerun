import { describe, expect, it } from 'vitest'

import { defaultInstanceEnvVar, instanceEnvVar, instanceRenames, instanceServerName, newServiceInstanceId, ordinalInstanceLabel } from './instances'
import type { RegistryEntry } from './registry'

const entry = (label?: string): RegistryEntry => ({ status: 'active', config: {}, mcpServers: [], envKeys: [], skills: [], installedAt: '', ...(label ? { label } : {}) })

describe('service instances', () => {
    it('draws a fresh six-character id', () => {
        expect(newServiceInstanceId()).toMatch(/^[a-z0-9]{6}$/)
    })

    it('caps the server name at 64 characters with a single dash', () => {
        expect(instanceServerName('gmail', 'k3x9ab')).toBe('gmail-k3x9ab')
        const long = instanceServerName('x'.repeat(80), 'k3x9ab')
        expect(long).toHaveLength(64)
        expect(long.endsWith('-k3x9ab')).toBe(true)
    })

    it('suffixes env vars with the instance id', () => {
        expect(instanceEnvVar('SLACK_BOT_TOKEN', 'k3x9ab')).toBe('SLACK_BOT_TOKEN_K3X9AB')
        expect(defaultInstanceEnvVar('google-drive', 'k3x9ab', 'api_key')).toBe('RERUN_SVC_GOOGLE_DRIVE_K3X9AB_API_KEY')
        expect(defaultInstanceEnvVar('google-drive', undefined, 'api_key')).toBe('RERUN_SVC_GOOGLE_DRIVE_API_KEY')
    })

    it('numbers a new account after the ones already shown', () => {
        expect(ordinalInstanceLabel('Gmail', { services: { gmail: entry() } }, 'gmail')).toBe('Gmail 2')
        expect(ordinalInstanceLabel('Gmail', { services: { gmail: entry(), 'gmail@aaaaaa': entry('Gmail 2') } }, 'gmail')).toBe('Gmail 3')
        expect(ordinalInstanceLabel('Gmail', { services: { 'gmail@bbbbbb': entry('Gmail 3') } }, 'gmail')).toBe('Gmail 2')
    })

    it('renames an account added before instances to the names a second account is compiled with', () => {
        expect(instanceRenames('cal-com', ['cal', 'cal-docs'], ['RERUN_SVC_CAL_COM_API_KEY', 'RERUN_SVC_CAL_COM_USER_PASS_BASIC', 'CAL_API_KEY'], 'k3x9ab')).toEqual({
            servers: { cal: 'cal-k3x9ab', 'cal-docs': 'cal-docs-k3x9ab' },
            env: {
                RERUN_SVC_CAL_COM_API_KEY: defaultInstanceEnvVar('cal-com', 'k3x9ab', 'API_KEY'),
                RERUN_SVC_CAL_COM_USER_PASS_BASIC: defaultInstanceEnvVar('cal-com', 'k3x9ab', 'USER_PASS_BASIC'),
                CAL_API_KEY: instanceEnvVar('CAL_API_KEY', 'k3x9ab'),
            },
        })
    })
})
