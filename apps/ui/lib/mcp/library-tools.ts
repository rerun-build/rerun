import { TEMPLATE_CATEGORIES } from '@rerun/contracts'

export const MAX_LIBRARY_RESULTS = 20

// The template library seen from a workspace that installs, not from an author: list_templates and
// the other template tools are the author's own.
export const LIBRARY_TOOL_DEFS = [
    {
        name: 'search_template_library',
        description: `Search the Rerun template library: ready-made teams of coworkers, each installed with their prompts, skills, scheduled tasks and apps in one call. Filter by words found in the title, tagline or tags, and by category. Each template gives its slug, what it does, its coworkers, the apps they use, how long its setup takes, its price and \`owned\`: whether this workspace can install it now (free, bought, or yours). Up to ${MAX_LIBRARY_RESULTS} results, featured first; \`total\` says how many match.`,
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Words to find, e.g. "linkedin" or "real estate".' },
                category: { type: 'string', enum: [...TEMPLATE_CATEGORIES] },
            },
        },
    },
    {
        name: 'install_template',
        description:
            'Install a template of the library into a Box: its coworkers land on the board with everything they came with, and their apps wait for the owner to connect them in the app. `inactive` counts the coworkers that landed switched off because the plan had no room left for them. Needs Can manage on the Box, a workspace with an active plan or trial, and a paid template bought for this workspace. A template already installed in the workspace is not installed twice: its coworkers come back instead.',
        inputSchema: {
            type: 'object',
            properties: {
                slug: { type: 'string', description: 'From search_template_library.' },
                spaceId: { type: 'string', description: 'The Box to install it into, from list_spaces.' },
            },
            required: ['slug', 'spaceId'],
        },
    },
] as const
