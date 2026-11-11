type Element = { $: Record<string, string> }
type Manifest = { manifest: { $: Record<string, string>; 'uses-permission': Element[]; application: { $: Record<string, string>; service: Element[] }[] } }

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PLAYBACK_PERMISSIONS, PLAYBACK_SERVICE, removeBackgroundPlayback } = require('./without-background-playback') as { PLAYBACK_PERMISSIONS: string[]; PLAYBACK_SERVICE: string; removeBackgroundPlayback: (manifest: Manifest) => Manifest }

const RECORDING_SERVICE = 'expo.modules.audio.service.AudioRecordingService'

function manifestWith({ permissions = [], services = [] }: { permissions?: string[]; services?: string[] } = {}): Manifest {
    return {
        manifest: {
            $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
            'uses-permission': permissions.map(name => ({ $: { 'android:name': name } })),
            application: [{ $: { 'android:name': '.MainApplication' }, service: services.map(name => ({ $: { 'android:name': name, 'android:exported': 'false' } })) }],
        },
    }
}

const permissionsOf = (manifest: Manifest) => manifest.manifest['uses-permission'].map(permission => permission.$)
const servicesOf = (manifest: Manifest) => manifest.manifest.application[0].service.map(service => service.$)

describe('without-background-playback', () => {
    it('swaps what expo-audio declares for markers that remove it at the merge', () => {
        const manifest = removeBackgroundPlayback(manifestWith({ permissions: ['android.permission.RECORD_AUDIO', ...PLAYBACK_PERMISSIONS], services: [PLAYBACK_SERVICE] }))

        expect(permissionsOf(manifest)).toEqual([{ 'android:name': 'android.permission.RECORD_AUDIO' }, ...PLAYBACK_PERMISSIONS.map(name => ({ 'android:name': name, 'tools:node': 'remove' }))])
        expect(servicesOf(manifest)).toEqual([{ 'android:name': PLAYBACK_SERVICE, 'tools:node': 'remove' }])
        expect(manifest.manifest.$['xmlns:tools']).toBe('http://schemas.android.com/tools')
    })

    it('marks them even before expo-audio has written them, so it does not add them after', () => {
        const manifest = removeBackgroundPlayback(manifestWith())

        expect(permissionsOf(manifest)).toEqual(PLAYBACK_PERMISSIONS.map(name => ({ 'android:name': name, 'tools:node': 'remove' })))
        expect(servicesOf(manifest)).toEqual([{ 'android:name': PLAYBACK_SERVICE, 'tools:node': 'remove' }])
    })

    it('leaves the other services alone and gives the same result run twice', () => {
        const once = removeBackgroundPlayback(manifestWith({ permissions: PLAYBACK_PERMISSIONS, services: [RECORDING_SERVICE, PLAYBACK_SERVICE] }))
        const twice = removeBackgroundPlayback(structuredClone(once))

        expect(servicesOf(once)).toEqual([
            { 'android:name': RECORDING_SERVICE, 'android:exported': 'false' },
            { 'android:name': PLAYBACK_SERVICE, 'tools:node': 'remove' },
        ])
        expect(twice).toEqual(once)
    })
})
