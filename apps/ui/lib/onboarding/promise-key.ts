import type en from '@rerun/i18n/messages/en/onboarding.json'

export type PromiseKey = keyof (typeof en)['promises']

/** The key of a starter card's promise in the language packs: its words, in camel case. */
export function promiseKey(promise: string): PromiseKey {
    const words = promise.toLowerCase().match(/[a-z0-9]+/g) ?? []
    return words.map((word, index) => (index === 0 ? word : word[0].toUpperCase() + word.slice(1))).join('') as PromiseKey
}
