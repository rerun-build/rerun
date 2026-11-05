import { afterEach, describe, expect, it, vi } from 'vitest'
import { childProcessEnv, envOverlay, inheritedEnv } from './child-env.js'

const engineEnv = {
    PATH: '/usr/bin',
    HOME: '/home/rerun',
    LANG: 'fr_FR.UTF-8',
    LC_TIME: 'en_GB.UTF-8',
    XDG_RUNTIME_DIR: '/run/user/1000',
    DISPLAY: ':1',
    https_proxy: 'http://proxy:3128',
    RERUN_API_KEY: 'engine-key',
    RERUN_PAIR_TOKEN: 'pair',
    RERUN_HUB_BASE_URL: 'https://hub.example',
    RERUN_DATA_DIR: '/data',
    RERUN_PORT: '3900',
    NODE_ENV: 'production',
    EMPTY: undefined,
}

afterEach(() => vi.unstubAllEnvs())

describe('inheritedEnv', () => {
    it('keeps the user, paths, locale, display and network settings and nothing of the engine configuration', () => {
        expect(inheritedEnv(engineEnv)).toEqual({
            PATH: '/usr/bin',
            HOME: '/home/rerun',
            LANG: 'fr_FR.UTF-8',
            LC_TIME: 'en_GB.UTF-8',
            XDG_RUNTIME_DIR: '/run/user/1000',
            DISPLAY: ':1',
            https_proxy: 'http://proxy:3128',
        })
    })

    it('reads the engine process by default', () => {
        vi.stubEnv('RERUN_API_KEY', 'live-key')
        vi.stubEnv('TZ', 'Europe/Paris')
        const env = inheritedEnv()
        expect(env.TZ).toBe('Europe/Paris')
        expect(env).not.toHaveProperty('RERUN_API_KEY')
    })
})

describe('childProcessEnv', () => {
    it('lays the agent variables and the extras over the inherited base, in that order', () => {
        vi.stubEnv('PATH', '/usr/bin')
        vi.stubEnv('RERUN_API_KEY', 'live-key')
        expect(childProcessEnv({ PATH: '/agent/bin', LINEAR_API_KEY: 'lin', RERUN_WORKSPACE: '/w' }, { RERUN_WORKSPACE: '/ws' })).toMatchObject({ PATH: '/agent/bin', LINEAR_API_KEY: 'lin', RERUN_WORKSPACE: '/ws' })
        expect(childProcessEnv({})).not.toHaveProperty('RERUN_API_KEY')
    })
})

describe('envOverlay', () => {
    it('empties every engine variable the child must not see and keeps the rest', () => {
        vi.stubEnv('RERUN_API_KEY', 'live-key')
        vi.stubEnv('PATH', '/usr/bin')
        const overlay = envOverlay({ PATH: '/usr/bin', CODEX_HOME: '/codex' })
        expect(overlay.RERUN_API_KEY).toBe('')
        expect(overlay.PATH).toBe('/usr/bin')
        expect(overlay.CODEX_HOME).toBe('/codex')
        expect({ ...process.env, ...overlay }.RERUN_API_KEY).toBe('')
        expect(Object.values(overlay).every(value => typeof value === 'string')).toBe(true)
    })
})
