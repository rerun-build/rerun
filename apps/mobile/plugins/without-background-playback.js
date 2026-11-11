// The app plays voice messages only while it is on screen, with no lock screen controls. expo-audio's
// `enableBackgroundPlayback` (on by default) also gives iOS its `audio` background mode, which stays, but
// on Android it declares a media playback foreground service that Google Play makes every app justify.
// This takes that service and its two permissions back out of the Android manifest, and marks them
// `tools:node="remove"` so no library brings them back at the manifest merge. Android only.
//
// It works in either mod order: a service or permission already in the manifest is dropped before the
// marker goes in, and expo-audio adds neither when it finds one of the same name.

const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins')

const PLAYBACK_SERVICE = 'expo.modules.audio.service.AudioControlsService'
const PLAYBACK_PERMISSIONS = ['android.permission.FOREGROUND_SERVICE', 'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK']

function removeBackgroundPlayback(manifest) {
    AndroidConfig.Manifest.ensureToolsAvailable(manifest)
    AndroidConfig.Permissions.addBlockedPermissions(manifest, PLAYBACK_PERMISSIONS)
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest)
    const otherServices = (application.service ?? []).filter(service => service.$?.['android:name'] !== PLAYBACK_SERVICE)
    application.service = [...otherServices, { $: { 'android:name': PLAYBACK_SERVICE, 'tools:node': 'remove' } }]
    return manifest
}

function withoutBackgroundPlayback(config) {
    return withAndroidManifest(config, config => {
        config.modResults = removeBackgroundPlayback(config.modResults)
        return config
    })
}

module.exports = withoutBackgroundPlayback
module.exports.removeBackgroundPlayback = removeBackgroundPlayback
module.exports.PLAYBACK_SERVICE = PLAYBACK_SERVICE
module.exports.PLAYBACK_PERMISSIONS = PLAYBACK_PERMISSIONS
