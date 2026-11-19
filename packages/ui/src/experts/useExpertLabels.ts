'use client'

import { useMemo } from 'react'

import { useKitTranslations, useUiLocale } from '../locale'
import { EXPERT_TYPE_LABELS, EXPERT_TYPES, type ExpertBadge, type LANGUAGE_OPTIONS, type SKILL_OPTIONS } from './options'

const SKILL_KEYS = {
    'Agent Design': 'agentDesign',
    'Workflow Automation': 'workflowAutomation',
    'RAG & Knowledge Bases': 'ragKnowledgeBases',
    'Integrations & APIs': 'integrationsApis',
    'MCP Servers': 'mcpServers',
    'Prompt Engineering': 'promptEngineering',
    'Data Pipelines': 'dataPipelines',
    'Chatbots & Support': 'chatbotsSupport',
    'Voice Agents': 'voiceAgents',
    'Lead Gen & Outreach': 'leadGenOutreach',
    'CRM Automation': 'crmAutomation',
    'Web Scraping': 'webScraping',
    'E-commerce Automation': 'ecommerceAutomation',
    'Analytics & Reporting': 'analyticsReporting',
    'Fine-tuning': 'fineTuning',
    'No-code Automation': 'noCodeAutomation',
} as const satisfies Record<(typeof SKILL_OPTIONS)[number], string>

const LANGUAGE_CODES: Record<(typeof LANGUAGE_OPTIONS)[number], string> = {
    English: 'en',
    Mandarin: 'cmn',
    Hindi: 'hi',
    Spanish: 'es',
    Arabic: 'ar',
    French: 'fr',
    Bengali: 'bn',
    Portuguese: 'pt',
    Russian: 'ru',
    Urdu: 'ur',
    Indonesian: 'id',
    German: 'de',
    Japanese: 'ja',
    Punjabi: 'pa',
    Turkish: 'tr',
    Korean: 'ko',
    Vietnamese: 'vi',
    Italian: 'it',
    Persian: 'fa',
    Tamil: 'ta',
    Thai: 'th',
    Dutch: 'nl',
    Polish: 'pl',
    Ukrainian: 'uk',
    Romanian: 'ro',
    Greek: 'el',
    Czech: 'cs',
    Swedish: 'sv',
    Hungarian: 'hu',
    Danish: 'da',
    Finnish: 'fi',
    Norwegian: 'no',
    Hebrew: 'he',
    Malay: 'ms',
    Filipino: 'fil',
    Swahili: 'sw',
    Cantonese: 'yue',
    Marathi: 'mr',
    Telugu: 'te',
    Gujarati: 'gu',
    Bulgarian: 'bg',
    Serbian: 'sr',
    Croatian: 'hr',
    Slovak: 'sk',
    Catalan: 'ca',
}

const isKeyOf = <T extends object>(record: T, key: string): key is Extract<keyof T, string> => Object.hasOwn(record, key)

// The expert vocabulary is stored in English (options.ts): these write a stored value in the reader's
// language. A value the lists no longer carry is shown as it was stored. English keeps the stored
// language names, which Intl words differently ("Mandarin" would read "Chinese").
export function useExpertLabels() {
    const t = useKitTranslations()
    const locale = useUiLocale()

    return useMemo(() => {
        const languageNames = locale === 'en' ? null : new Intl.DisplayNames([locale], { type: 'language' })
        return {
            badge: (badge: ExpertBadge) => {
                const type = EXPERT_TYPES.find(candidate => EXPERT_TYPE_LABELS[candidate] === badge)
                return type ? t(`experts.types.${type}.title`) : badge
            },
            skill: (skill: string) => (isKeyOf(SKILL_KEYS, skill) ? t(`experts.skills.${SKILL_KEYS[skill]}`) : skill),
            language: (language: string) => {
                const name = languageNames && isKeyOf(LANGUAGE_CODES, language) ? languageNames.of(LANGUAGE_CODES[language]) : undefined
                return name ? name.charAt(0).toLocaleUpperCase(locale) + name.slice(1) : language
            },
        }
    }, [t, locale])
}
