import { vi } from 'vitest'

vi.mock('next-intl', async () => {
    const { createTranslator } = await import('use-intl')
    const { ENGLISH_MESSAGES } = await import('@moldwright/i18n/messages/en')
    const translators = new Map<string | undefined, ReturnType<typeof createTranslator>>()
    const translator = (namespace?: string) => {
        if (!translators.has(namespace)) translators.set(namespace, createTranslator({ locale: 'en', messages: ENGLISH_MESSAGES, namespace: namespace as never }))
        return translators.get(namespace)!
    }
    return {
        useTranslations: (namespace?: string) => translator(namespace),
        useLocale: () => 'en',
        useNow: () => new Date(),
        useTimeZone: () => 'UTC',
        useMessages: () => ENGLISH_MESSAGES,
        NextIntlClientProvider: ({ children }: { children: unknown }) => children,
    }
})

vi.mock('next-intl/server', async () => {
    const { createTranslator } = await import('use-intl')
    const { ENGLISH_MESSAGES } = await import('@moldwright/i18n/messages/en')
    return {
        getTranslations: async (options?: string | { namespace?: string; locale?: string }) => {
            const namespace = typeof options === 'string' ? options : options?.namespace
            return createTranslator({ locale: 'en', messages: ENGLISH_MESSAGES, namespace: namespace as never })
        },
        getLocale: async () => 'en',
        getMessages: async () => ENGLISH_MESSAGES,
        getRequestConfig: (factory: unknown) => factory,
    }
})
