import englishKit from '@rerun/i18n/messages/en/kit.json'
import { z } from 'zod'

import { BUDGET_OPTIONS, EXPERT_AVAILABILITIES, EXPERT_TYPES, LANGUAGE_OPTIONS, SKILL_OPTIONS } from './options'

// Owner-facing schema: what an expert may edit about their own fiche, from the landing claim link or
// from the app. No React here, so both apps' server actions re-parse it at their boundary.
export { EXPERT_AVAILABILITIES, EXPERT_TYPES } from './options'

const budgetValues: readonly string[] = BUDGET_OPTIONS
const skillValues: readonly string[] = SKILL_OPTIONS
const languageValues: readonly string[] = LANGUAGE_OPTIONS

export type ExpertValidationMessage = keyof typeof englishKit.experts.validation

// The server parses with the English messages; the wizard builds its own copy with the reader's.
export function buildEditExpertSchema(message: (key: ExpertValidationMessage) => string) {
    return z.object({
        name: z
            .string()
            .trim()
            .min(1, message('nameRequired'))
            .max(80, message('nameTooLong'))
            .refine(value => !/[<>]/.test(value), message('nameInvalid')),
        type: z.enum(EXPERT_TYPES),
        email: z.string().trim().min(1, message('emailRequired')).email(message('emailInvalid')),
        location: z.string().trim(),
        bio: z.string().trim().max(4000, message('bioTooLong')),
        availability: z.enum(EXPERT_AVAILABILITIES),
        budget: z.string().trim().refine(value => value === '' || budgetValues.includes(value), message('budgetInvalid')),
        avatar_url: z.string().trim(),
        banner_url: z.string().trim(),
        skills: z.array(z.string()).refine(values => values.every(value => skillValues.includes(value)), message('skillInvalid')),
        languages: z.array(z.string()).refine(values => values.every(value => languageValues.includes(value)), message('languageInvalid')),
        x_url: z.string().trim(),
        linkedin_url: z.string().trim(),
        github_url: z.string().trim(),
        website_url: z.string().trim(),
    })
}

export const editExpertSchema = buildEditExpertSchema(key => englishKit.experts.validation[key])

export type EditExpertValues = z.infer<typeof editExpertSchema>
