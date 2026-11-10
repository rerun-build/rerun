// Single source of truth for the experts marketplace vocabulary, shared by the landing
// (public filters + owner claim/edit flow) and apps/ui (admin edit form + LinkedIn importer).
// Values here are what lands in the `experts` table, so the LLM importer, the public filters
// and both edit forms all agree. No React here on purpose: server code and Trigger.dev tasks
// import this module, so it must stay free of component imports.

import type { BadgeTone } from '../primitives/badge'

export const EXPERT_TYPES = ['studio', 'freelancer', 'expert'] as const

export const EXPERT_AVAILABILITIES = ['available', 'soon', 'unavailable'] as const

export const EXPERT_STATUSES = ['draft', 'invited', 'published', 'declined'] as const

// Where the fiche came from, and — for a fiche that came from the public creator program — where
// its application stands. Orthogonal to `status`, which tracks the marketplace listing: an accepted
// creator keeps a `draft` listing until they fill and publish their own profile.
export const EXPERT_SOURCES = ['seed', 'import', 'application'] as const

export const EXPERT_APPLICATION_STATUSES = ['pending', 'accepted', 'rejected'] as const

export type ExpertType = (typeof EXPERT_TYPES)[number]
export type ExpertAvailability = (typeof EXPERT_AVAILABILITIES)[number]
export type ExpertStatus = (typeof EXPERT_STATUSES)[number]
export type ExpertSource = (typeof EXPERT_SOURCES)[number]
export type ExpertApplicationStatus = (typeof EXPERT_APPLICATION_STATUSES)[number]
export type ExpertBadge = 'Studio' | 'Freelancer' | 'Expert'

export const BUDGET_OPTIONS = [
    '$1,000 – $5,000',
    '$5,000 – $10,000',
    '$10,000 – $20,000',
    '$20,000 – $50,000',
    '$50,000 – $100,000',
    '$100,000+',
] as const

export const SKILL_OPTIONS = [
    'Agent Design',
    'Workflow Automation',
    'RAG & Knowledge Bases',
    'Integrations & APIs',
    'MCP Servers',
    'Prompt Engineering',
    'Data Pipelines',
    'Chatbots & Support',
    'Voice Agents',
    'Lead Gen & Outreach',
    'CRM Automation',
    'Web Scraping',
    'E-commerce Automation',
    'Analytics & Reporting',
    'Fine-tuning',
    'No-code Automation',
] as const

export const LANGUAGE_OPTIONS = [
    'English',
    'Mandarin',
    'Hindi',
    'Spanish',
    'Arabic',
    'French',
    'Bengali',
    'Portuguese',
    'Russian',
    'Urdu',
    'Indonesian',
    'German',
    'Japanese',
    'Punjabi',
    'Turkish',
    'Korean',
    'Vietnamese',
    'Italian',
    'Persian',
    'Tamil',
    'Thai',
    'Dutch',
    'Polish',
    'Ukrainian',
    'Romanian',
    'Greek',
    'Czech',
    'Swedish',
    'Hungarian',
    'Danish',
    'Finnish',
    'Norwegian',
    'Hebrew',
    'Malay',
    'Filipino',
    'Swahili',
    'Cantonese',
    'Marathi',
    'Telugu',
    'Gujarati',
    'Bulgarian',
    'Serbian',
    'Croatian',
    'Slovak',
    'Catalan',
] as const

export type ExpertAvailabilityLabel = 'Available' | 'Available soon' | 'Not available'

export const EXPERT_TYPE_LABELS: Record<ExpertType, ExpertBadge> = {
    studio: 'Studio',
    freelancer: 'Freelancer',
    expert: 'Expert',
}

export const EXPERT_AVAILABILITY_LABELS: Record<ExpertAvailability, ExpertAvailabilityLabel> = {
    available: 'Available',
    soon: 'Available soon',
    unavailable: 'Not available',
}

export const EXPERT_STATUS_LABELS: Record<ExpertStatus, string> = {
    draft: 'Draft',
    invited: 'Invited',
    published: 'Published',
    declined: 'Declined',
}

export const EXPERT_SOURCE_LABELS: Record<ExpertSource, string> = {
    seed: 'Seed',
    import: 'Import',
    application: 'Application',
}

export const EXPERT_APPLICATION_STATUS_LABELS: Record<ExpertApplicationStatus, string> = {
    pending: 'Pending review',
    accepted: 'Accepted',
    rejected: 'Rejected',
}

export const TYPE_OPTIONS: readonly ExpertBadge[] = EXPERT_TYPES.map(type => EXPERT_TYPE_LABELS[type])

export const AVAILABILITY_OPTIONS: readonly ExpertAvailabilityLabel[] = EXPERT_AVAILABILITIES.map(
    availability => EXPERT_AVAILABILITY_LABELS[availability],
)

export function badgeFromType(type: ExpertType): ExpertBadge {
    return EXPERT_TYPE_LABELS[type]
}

export function availabilityLabel(availability: ExpertAvailability): ExpertAvailabilityLabel {
    return EXPERT_AVAILABILITY_LABELS[availability]
}

const BADGE_TONES: Record<ExpertBadge, BadgeTone> = {
    Studio: 'neutral',
    Freelancer: 'neutral',
    Expert: 'brand',
}

export function badgeTone(badge: ExpertBadge): BadgeTone {
    return BADGE_TONES[badge]
}

const AVAILABILITY_DOTS: Record<ExpertAvailability, string> = {
    available: 'bg-emerald-400',
    soon: 'bg-amber-400',
    unavailable: 'bg-foreground/30',
}

export function availabilityDot(availability: ExpertAvailability): string {
    return AVAILABILITY_DOTS[availability]
}

export function markdownToPlainText(markdown: string): string {
    return markdown
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/^\s{0,3}(?:[-*_]\s?){3,}$/gm, ' ')
        .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
        .replace(/[*_~]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
}

export function slugifyExpertName(name: string): string {
    return name
        .toLowerCase()
        .normalize('NFKD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60)
}
