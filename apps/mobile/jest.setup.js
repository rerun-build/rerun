// Reanimated needs its native worklets runtime, which Jest does not have; its own mock leaves out
// `useReducedMotion`, which the HITL pager reads.
jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'))
jest.mock('react-native-reanimated', () => ({ ...require('react-native-reanimated/mock'), useReducedMotion: () => false }))

// The screens read their strings through use-intl. Tests render them without the root provider, in
// English, the language their assertions are written in.
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

// The haptics are native calls: Jest's automock leaves out AndroidHaptics and the system feedback the
// Android twin plays, so the whole module is stubbed with its real enums.
jest.mock('expo-haptics', () => ({
    ...jest.requireActual('expo-haptics'),
    selectionAsync: jest.fn(async () => {}),
    impactAsync: jest.fn(async () => {}),
    notificationAsync: jest.fn(async () => {}),
    performAndroidHapticsAsync: jest.fn(async () => {}),
}))
