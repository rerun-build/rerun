import { z } from 'zod'

import { BUDGET_OPTIONS, EXPERT_AVAILABILITIES, EXPERT_STATUSES, EXPERT_TYPES, LANGUAGE_OPTIONS, SKILL_OPTIONS } from '@moldwright/ui/experts/options'

import { isValidTimeZone } from './schedule/window'

const budgetValues: readonly string[] = BUDGET_OPTIONS
const skillValues: readonly string[] = SKILL_OPTIONS
const languageValues: readonly string[] = LANGUAGE_OPTIONS

export const adminExpertSchema = z.object({
    name: z.string().trim().min(1, 'Name is required'),
    slug: z
        .string()
        .trim()
        .min(1, 'Slug is required')
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug can only contain lowercase letters, numbers and dashes'),
    type: z.enum(EXPERT_TYPES),
    status: z.enum(EXPERT_STATUSES),
    featured: z.boolean(),
    seo_indexed: z.boolean(),
    availability: z.enum(EXPERT_AVAILABILITIES),
    email: z.string().trim().refine(value => value === '' || z.string().email().safeParse(value).success, 'Invalid email'),
    location: z.string().trim(),
    timezone: z.string().trim().refine(value => value === '' || isValidTimeZone(value), 'Unknown timezone'),
    bio: z.string().trim().max(4000, 'Bio is too long'),
    budget: z.string().trim().refine(value => value === '' || budgetValues.includes(value), 'Invalid budget'),
    avatar_url: z.string().trim(),
    banner_url: z.string().trim(),
    skills: z.array(z.string()).refine(values => values.every(value => skillValues.includes(value)), 'Invalid skill'),
    languages: z.array(z.string()).refine(values => values.every(value => languageValues.includes(value)), 'Invalid language'),
    x_url: z.string().trim(),
    linkedin_url: z.string().trim(),
    github_url: z.string().trim(),
    website_url: z.string().trim(),
})

export type AdminExpertValues = z.infer<typeof adminExpertSchema>
