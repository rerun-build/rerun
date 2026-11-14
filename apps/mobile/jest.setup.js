jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'))
jest.mock('react-native-reanimated', () => ({ ...require('react-native-reanimated/mock'), useReducedMotion: () => false }))

jest.mock('use-intl', () => {
    const actual = jest.requireActual('use-intl')
    const { messagesFor } = require('./src/i18n/messages')
    const messages = messagesFor('en')
    return {
        ...actual,
        useLocale: () => 'en',
        useTranslations: namespace => actual.createTranslator({ locale: 'en', messages, namespace }),
    }
})

jest.mock('expo-audio', () => ({
    RecordingPresets: { HIGH_QUALITY: {} },
    requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })),
    setAudioModeAsync: jest.fn(async () => {}),
    useAudioRecorder: () => ({ uri: 'file:///recording.m4a', record: jest.fn(), stop: jest.fn(async () => {}), prepareToRecordAsync: jest.fn(async () => {}), getStatus: () => ({ metering: -60, durationMillis: 0 }) }),
    useAudioPlayer: () => ({ play: jest.fn(), pause: jest.fn(), seekTo: jest.fn(async () => {}), remove: jest.fn() }),
    useAudioPlayerStatus: () => ({ playing: false, currentTime: 0, duration: 0, isLoaded: false }),
}))

jest.mock('expo-haptics', () => ({
    ...jest.requireActual('expo-haptics'),
    selectionAsync: jest.fn(async () => {}),
    impactAsync: jest.fn(async () => {}),
    notificationAsync: jest.fn(async () => {}),
    performAndroidHapticsAsync: jest.fn(async () => {}),
}))
