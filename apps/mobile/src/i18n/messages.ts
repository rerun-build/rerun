import { DEFAULT_LOCALE, mergeMessages, type Locale } from '@rerun/i18n'

import enChatErrors from '@rerun/i18n/messages/en/chatErrors.json'
import enMobileAuth from '@rerun/i18n/messages/en/mobileAuth.json'
import enMobileCards from '@rerun/i18n/messages/en/mobileCards.json'
import enMobileChat from '@rerun/i18n/messages/en/mobileChat.json'
import enMobileCommon from '@rerun/i18n/messages/en/mobileCommon.json'
import enMobileCoworker from '@rerun/i18n/messages/en/mobileCoworker.json'
import enMobileHitl from '@rerun/i18n/messages/en/mobileHitl.json'
import enMobileHome from '@rerun/i18n/messages/en/mobileHome.json'
import enMobileOnboarding from '@rerun/i18n/messages/en/mobileOnboarding.json'
import enMobileProviders from '@rerun/i18n/messages/en/mobileProviders.json'
import enMobileSettings from '@rerun/i18n/messages/en/mobileSettings.json'
import enMobileSteps from '@rerun/i18n/messages/en/mobileSteps.json'
import enSubRuns from '@rerun/i18n/messages/en/subRuns.json'
import enTools from '@rerun/i18n/messages/en/tools.json'
import frChatErrors from '@rerun/i18n/messages/fr/chatErrors.json'
import frMobileAuth from '@rerun/i18n/messages/fr/mobileAuth.json'
import frMobileCards from '@rerun/i18n/messages/fr/mobileCards.json'
import frMobileChat from '@rerun/i18n/messages/fr/mobileChat.json'
import frMobileCommon from '@rerun/i18n/messages/fr/mobileCommon.json'
import frMobileCoworker from '@rerun/i18n/messages/fr/mobileCoworker.json'
import frMobileHitl from '@rerun/i18n/messages/fr/mobileHitl.json'
import frMobileHome from '@rerun/i18n/messages/fr/mobileHome.json'
import frMobileOnboarding from '@rerun/i18n/messages/fr/mobileOnboarding.json'
import frMobileProviders from '@rerun/i18n/messages/fr/mobileProviders.json'
import frMobileSettings from '@rerun/i18n/messages/fr/mobileSettings.json'
import frMobileSteps from '@rerun/i18n/messages/fr/mobileSteps.json'
import frSubRuns from '@rerun/i18n/messages/fr/subRuns.json'
import frTools from '@rerun/i18n/messages/fr/tools.json'
import esChatErrors from '@rerun/i18n/messages/es/chatErrors.json'
import esMobileAuth from '@rerun/i18n/messages/es/mobileAuth.json'
import esMobileCards from '@rerun/i18n/messages/es/mobileCards.json'
import esMobileChat from '@rerun/i18n/messages/es/mobileChat.json'
import esMobileCommon from '@rerun/i18n/messages/es/mobileCommon.json'
import esMobileCoworker from '@rerun/i18n/messages/es/mobileCoworker.json'
import esMobileHitl from '@rerun/i18n/messages/es/mobileHitl.json'
import esMobileHome from '@rerun/i18n/messages/es/mobileHome.json'
import esMobileOnboarding from '@rerun/i18n/messages/es/mobileOnboarding.json'
import esMobileProviders from '@rerun/i18n/messages/es/mobileProviders.json'
import esMobileSettings from '@rerun/i18n/messages/es/mobileSettings.json'
import esMobileSteps from '@rerun/i18n/messages/es/mobileSteps.json'
import esSubRuns from '@rerun/i18n/messages/es/subRuns.json'
import esTools from '@rerun/i18n/messages/es/tools.json'

// Only the app's own namespaces ship in the bundle: the web's strings would weigh on every launch.
const english = { chatErrors: enChatErrors, mobileAuth: enMobileAuth, mobileCards: enMobileCards, mobileChat: enMobileChat, mobileCommon: enMobileCommon, mobileCoworker: enMobileCoworker, mobileHitl: enMobileHitl, mobileHome: enMobileHome, mobileOnboarding: enMobileOnboarding, mobileProviders: enMobileProviders, mobileSettings: enMobileSettings, mobileSteps: enMobileSteps, subRuns: enSubRuns, tools: enTools }
const french = { chatErrors: frChatErrors, mobileAuth: frMobileAuth, mobileCards: frMobileCards, mobileChat: frMobileChat, mobileCommon: frMobileCommon, mobileCoworker: frMobileCoworker, mobileHitl: frMobileHitl, mobileHome: frMobileHome, mobileOnboarding: frMobileOnboarding, mobileProviders: frMobileProviders, mobileSettings: frMobileSettings, mobileSteps: frMobileSteps, subRuns: frSubRuns, tools: frTools }
const spanish = { chatErrors: esChatErrors, mobileAuth: esMobileAuth, mobileCards: esMobileCards, mobileChat: esMobileChat, mobileCommon: esMobileCommon, mobileCoworker: esMobileCoworker, mobileHitl: esMobileHitl, mobileHome: esMobileHome, mobileOnboarding: esMobileOnboarding, mobileProviders: esMobileProviders, mobileSettings: esMobileSettings, mobileSteps: esMobileSteps, subRuns: esSubRuns, tools: esTools }

export type MobileMessages = typeof english

const PACKS: Record<Locale, Partial<Record<keyof MobileMessages, object>>> = { en: english, fr: french, es: spanish }

const merged = new Map<Locale, MobileMessages>()

// The English source under the pack, so a key the pack lacks still reads in English.
export function messagesFor(locale: Locale): MobileMessages {
    if (locale === DEFAULT_LOCALE) return english
    let messages = merged.get(locale)
    if (!messages) {
        messages = mergeMessages(english, PACKS[locale] as Record<string, never>)
        merged.set(locale, messages)
    }
    return messages
}
