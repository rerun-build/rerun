import { describe, expect, it } from 'vitest'
import { findVaultConflicts } from './conflicts.js'
import type { LoadedVaultItem } from './types.js'

type Footprint = Pick<LoadedVaultItem, 'id' | 'config' | 'env'>

function getxapiAccount(id: string, suffix: string): Footprint {
    const config = {
        kind: 'service',
        slug: 'getxapi',
        name: 'GetXAPI',
        sharedWithAll: false,
        agentIds: ['alice'],
        mcpServers: [{ name: `getxapi${suffix ? `-${suffix}` : ''}`, command: 'npx', args: ['-y', '@getxapi/mcp@latest'] }],
        skills: [{ slug: 'getxapi-usage', name: 'getxapi-usage', description: '', body: '# GetXAPI' }],
    } as unknown as LoadedVaultItem['config']
    return { id, config, env: { [`RERUN_SVC_GETXAPI${suffix ? `_${suffix.toUpperCase()}` : ''}_GETXAPI_KEY`]: id } }
}

describe('findVaultConflicts', () => {
    it('lets two accounts of one app sit on one coworker once the second has its own names', () => {
        expect(findVaultConflicts(getxapiAccount('second', 'k3x9ab'), [getxapiAccount('first', '')], ['alice'])).toEqual([])
    })

    it('refuses two accounts of one app that share their names', () => {
        const conflicts = findVaultConflicts(getxapiAccount('second', ''), [getxapiAccount('first', '')], ['alice'])
        expect(conflicts).toEqual([
            { agentId: 'alice', itemId: 'first', kind: 'env', name: 'RERUN_SVC_GETXAPI_GETXAPI_KEY' },
            { agentId: 'alice', itemId: 'first', kind: 'server', name: 'getxapi' },
        ])
    })
})
