import { DEFAULT_LOCALE, mergeMessages, type Locale } from '@rerun/i18n'

import enChatErrors from '@rerun/i18n/messages/en/chatErrors.json'
import enErrors from '@rerun/i18n/messages/en/errors.json'
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
import frErrors from '@rerun/i18n/messages/fr/errors.json'
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
import esErrors from '@rerun/i18n/messages/es/errors.json'
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
import ptChatErrors from '@rerun/i18n/messages/pt/chatErrors.json'
import ptErrors from '@rerun/i18n/messages/pt/errors.json'
import ptMobileAuth from '@rerun/i18n/messages/pt/mobileAuth.json'
import ptMobileCards from '@rerun/i18n/messages/pt/mobileCards.json'
import ptMobileChat from '@rerun/i18n/messages/pt/mobileChat.json'
import ptMobileCommon from '@rerun/i18n/messages/pt/mobileCommon.json'
import ptMobileCoworker from '@rerun/i18n/messages/pt/mobileCoworker.json'
import ptMobileHitl from '@rerun/i18n/messages/pt/mobileHitl.json'
import ptMobileHome from '@rerun/i18n/messages/pt/mobileHome.json'
import ptMobileOnboarding from '@rerun/i18n/messages/pt/mobileOnboarding.json'
import ptMobileProviders from '@rerun/i18n/messages/pt/mobileProviders.json'
import ptMobileSettings from '@rerun/i18n/messages/pt/mobileSettings.json'
import ptMobileSteps from '@rerun/i18n/messages/pt/mobileSteps.json'
import ptSubRuns from '@rerun/i18n/messages/pt/subRuns.json'
import ptTools from '@rerun/i18n/messages/pt/tools.json'
import deChatErrors from '@rerun/i18n/messages/de/chatErrors.json'
import deErrors from '@rerun/i18n/messages/de/errors.json'
import deMobileAuth from '@rerun/i18n/messages/de/mobileAuth.json'
import deMobileCards from '@rerun/i18n/messages/de/mobileCards.json'
import deMobileChat from '@rerun/i18n/messages/de/mobileChat.json'
import deMobileCommon from '@rerun/i18n/messages/de/mobileCommon.json'
import deMobileCoworker from '@rerun/i18n/messages/de/mobileCoworker.json'
import deMobileHitl from '@rerun/i18n/messages/de/mobileHitl.json'
import deMobileHome from '@rerun/i18n/messages/de/mobileHome.json'
import deMobileOnboarding from '@rerun/i18n/messages/de/mobileOnboarding.json'
import deMobileProviders from '@rerun/i18n/messages/de/mobileProviders.json'
import deMobileSettings from '@rerun/i18n/messages/de/mobileSettings.json'
import deMobileSteps from '@rerun/i18n/messages/de/mobileSteps.json'
import deSubRuns from '@rerun/i18n/messages/de/subRuns.json'
import deTools from '@rerun/i18n/messages/de/tools.json'
import trChatErrors from '@rerun/i18n/messages/tr/chatErrors.json'
import trErrors from '@rerun/i18n/messages/tr/errors.json'
import trMobileAuth from '@rerun/i18n/messages/tr/mobileAuth.json'
import trMobileCards from '@rerun/i18n/messages/tr/mobileCards.json'
import trMobileChat from '@rerun/i18n/messages/tr/mobileChat.json'
import trMobileCommon from '@rerun/i18n/messages/tr/mobileCommon.json'
import trMobileCoworker from '@rerun/i18n/messages/tr/mobileCoworker.json'
import trMobileHitl from '@rerun/i18n/messages/tr/mobileHitl.json'
import trMobileHome from '@rerun/i18n/messages/tr/mobileHome.json'
import trMobileOnboarding from '@rerun/i18n/messages/tr/mobileOnboarding.json'
import trMobileProviders from '@rerun/i18n/messages/tr/mobileProviders.json'
import trMobileSettings from '@rerun/i18n/messages/tr/mobileSettings.json'
import trMobileSteps from '@rerun/i18n/messages/tr/mobileSteps.json'
import trSubRuns from '@rerun/i18n/messages/tr/subRuns.json'
import trTools from '@rerun/i18n/messages/tr/tools.json'
import itChatErrors from '@rerun/i18n/messages/it/chatErrors.json'
import itErrors from '@rerun/i18n/messages/it/errors.json'
import itMobileAuth from '@rerun/i18n/messages/it/mobileAuth.json'
import itMobileCards from '@rerun/i18n/messages/it/mobileCards.json'
import itMobileChat from '@rerun/i18n/messages/it/mobileChat.json'
import itMobileCommon from '@rerun/i18n/messages/it/mobileCommon.json'
import itMobileCoworker from '@rerun/i18n/messages/it/mobileCoworker.json'
import itMobileHitl from '@rerun/i18n/messages/it/mobileHitl.json'
import itMobileHome from '@rerun/i18n/messages/it/mobileHome.json'
import itMobileOnboarding from '@rerun/i18n/messages/it/mobileOnboarding.json'
import itMobileProviders from '@rerun/i18n/messages/it/mobileProviders.json'
import itMobileSettings from '@rerun/i18n/messages/it/mobileSettings.json'
import itMobileSteps from '@rerun/i18n/messages/it/mobileSteps.json'
import itSubRuns from '@rerun/i18n/messages/it/subRuns.json'
import itTools from '@rerun/i18n/messages/it/tools.json'

// Only the app's own namespaces ship in the bundle: the web's strings would weigh on every launch.
const english = { chatErrors: enChatErrors, errors: enErrors, mobileAuth: enMobileAuth, mobileCards: enMobileCards, mobileChat: enMobileChat, mobileCommon: enMobileCommon, mobileCoworker: enMobileCoworker, mobileHitl: enMobileHitl, mobileHome: enMobileHome, mobileOnboarding: enMobileOnboarding, mobileProviders: enMobileProviders, mobileSettings: enMobileSettings, mobileSteps: enMobileSteps, subRuns: enSubRuns, tools: enTools }
const french = { chatErrors: frChatErrors, errors: frErrors, mobileAuth: frMobileAuth, mobileCards: frMobileCards, mobileChat: frMobileChat, mobileCommon: frMobileCommon, mobileCoworker: frMobileCoworker, mobileHitl: frMobileHitl, mobileHome: frMobileHome, mobileOnboarding: frMobileOnboarding, mobileProviders: frMobileProviders, mobileSettings: frMobileSettings, mobileSteps: frMobileSteps, subRuns: frSubRuns, tools: frTools }
const spanish = { chatErrors: esChatErrors, errors: esErrors, mobileAuth: esMobileAuth, mobileCards: esMobileCards, mobileChat: esMobileChat, mobileCommon: esMobileCommon, mobileCoworker: esMobileCoworker, mobileHitl: esMobileHitl, mobileHome: esMobileHome, mobileOnboarding: esMobileOnboarding, mobileProviders: esMobileProviders, mobileSettings: esMobileSettings, mobileSteps: esMobileSteps, subRuns: esSubRuns, tools: esTools }
const portuguese = { chatErrors: ptChatErrors, errors: ptErrors, mobileAuth: ptMobileAuth, mobileCards: ptMobileCards, mobileChat: ptMobileChat, mobileCommon: ptMobileCommon, mobileCoworker: ptMobileCoworker, mobileHitl: ptMobileHitl, mobileHome: ptMobileHome, mobileOnboarding: ptMobileOnboarding, mobileProviders: ptMobileProviders, mobileSettings: ptMobileSettings, mobileSteps: ptMobileSteps, subRuns: ptSubRuns, tools: ptTools }
const german = { chatErrors: deChatErrors, errors: deErrors, mobileAuth: deMobileAuth, mobileCards: deMobileCards, mobileChat: deMobileChat, mobileCommon: deMobileCommon, mobileCoworker: deMobileCoworker, mobileHitl: deMobileHitl, mobileHome: deMobileHome, mobileOnboarding: deMobileOnboarding, mobileProviders: deMobileProviders, mobileSettings: deMobileSettings, mobileSteps: deMobileSteps, subRuns: deSubRuns, tools: deTools }
const turkish = { chatErrors: trChatErrors, errors: trErrors, mobileAuth: trMobileAuth, mobileCards: trMobileCards, mobileChat: trMobileChat, mobileCommon: trMobileCommon, mobileCoworker: trMobileCoworker, mobileHitl: trMobileHitl, mobileHome: trMobileHome, mobileOnboarding: trMobileOnboarding, mobileProviders: trMobileProviders, mobileSettings: trMobileSettings, mobileSteps: trMobileSteps, subRuns: trSubRuns, tools: trTools }
const italian = { chatErrors: itChatErrors, errors: itErrors, mobileAuth: itMobileAuth, mobileCards: itMobileCards, mobileChat: itMobileChat, mobileCommon: itMobileCommon, mobileCoworker: itMobileCoworker, mobileHitl: itMobileHitl, mobileHome: itMobileHome, mobileOnboarding: itMobileOnboarding, mobileProviders: itMobileProviders, mobileSettings: itMobileSettings, mobileSteps: itMobileSteps, subRuns: itSubRuns, tools: itTools }

export type MobileMessages = typeof english

const PACKS: Record<Locale, Partial<Record<keyof MobileMessages, object>>> = { en: english, fr: french, es: spanish, pt: portuguese, de: german, tr: turkish, it: italian }

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
