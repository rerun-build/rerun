import { generateObject } from 'ai'
import { z } from 'zod'
import { BUDGET_OPTIONS, EXPERT_TYPES, LANGUAGE_OPTIONS, SKILL_OPTIONS } from '@moldwright/ui/experts/options'
import { openrouter } from '@/lib/ai/openrouter'
import type { ExpertSource } from './source'

const ENRICH_MODEL = process.env.EXPERTS_ENRICH_MODEL ?? 'anthropic/claude-sonnet-5'

const enrichedExpertSchema = z.object({
    name: z.string().describe('Full name of the person or studio'),
    type: z.enum(EXPERT_TYPES).describe('freelancer for an individual, studio for an agency/company, expert only for a recognized authority'),
    email: z.string().describe('Contact email exactly as it appears in the profile, empty string if none. Never invent one'),
    location: z.string().describe('City, Country. Empty string if unknown'),
    timezone: z.string().describe('IANA timezone of that location, e.g. Europe/Rome. Empty string if the location is unknown or too vague'),
    bio: z.string().max(4000).describe('A polished markdown bio (2-4 short paragraphs) written from the summary and experiences, first person as if the expert wrote it themselves, no headings'),
    budget: z.enum(BUDGET_OPTIONS).nullable().describe('Only if a project budget range can be reasonably inferred, otherwise null'),
    skills: z.array(z.enum(SKILL_OPTIONS)).describe('Only skills that clearly match the allowed list; empty if none apply'),
    languages: z.array(z.enum(LANGUAGE_OPTIONS)).describe('Languages the person speaks, mapped to the allowed list; empty if unknown'),
    x_url: z.string().describe('Full https URL to X/Twitter, empty string if none'),
    linkedin_url: z.string().describe('Full https URL to a LinkedIn profile, empty string if none'),
    github_url: z.string().describe('Full https URL to GitHub, empty string if none'),
    website_url: z.string().describe('Full https URL to a personal/company website, empty string if none'),
})

export type EnrichedExpert = z.infer<typeof enrichedExpertSchema>

const SOURCE_INSTRUCTIONS: Record<ExpertSource, string> = {
    linkedin: 'The JSON below is a scraped LinkedIn profile: basic_info, experience and education.',
    x: [
        'The JSON below is a scraped X (Twitter) profile and its latest tweets.',
        'An X bio is capped at 160 characters, so infer their expertise mainly from the tweets: what they build, ship and talk about. Never quote or paraphrase a single tweet in the bio, and ignore retweets, replies and one-off opinions.',
        'Take the name from the display name, stripped of emojis, job titles, leading @ and suffixes such as "| building X". If it is only a handle or a pseudonym, keep it as is.',
        'The bio text only holds t.co links: take website_url, github_url and linkedin_url from entities.url.urls[].expanded_url and entities.description.urls[].expanded_url instead, and upgrade them to https. Never output a t.co URL.',
        'X locations are free text ("SF 🌉", "Remote"): leave location and timezone empty rather than guessing.',
        'Follower counts and X Premium status are signals for type, not facts to mention.',
    ].join('\n'),
}

export async function enrichExpert(source: ExpertSource, profile: unknown): Promise<EnrichedExpert> {
    const { object } = await generateObject({
        model: openrouter(ENRICH_MODEL),
        schema: enrichedExpertSchema,
        prompt: [
            'You are building a marketplace profile for an AI automation expert from their scraped public data.',
            'Fill as many fields as possible, but only use values that genuinely fit. For skills, languages and budget you MUST pick from the allowed enum values; if nothing fits, leave the array empty or budget null.',
            'Write the bio in clean markdown, in the first person, as if the expert wrote it themselves: "I" for a freelancer or expert, "we" for a studio. Never refer to them by name or in the third person. Focus on what they build and their expertise. Do not invent facts.',
            '',
            SOURCE_INSTRUCTIONS[source],
            JSON.stringify(profile).slice(0, 20000),
        ].join('\n'),
    })
    return object
}
