import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import type { RunContext } from '../../runtime/context.js'
import { callHub } from '../../runtime/hub.js'

export function hubTools(ctx: RunContext): ToolSet {
    const call = (name: string, args: Record<string, unknown>) => callHub(ctx.agent, name, args)
    return {
        rerun_hub_service_search: tool({
            description:
                'Semantic search over the Rerun service library (Stripe, Gmail, Figma, Metricool, …) for capabilities you can install on yourself. ALWAYS call this FIRST, before building any new integration or app yourself — describe the capability you need in natural language (e.g. "schedule social media posts") and it returns the most relevant ready-made services, ranked, with whether each is already installed. If nothing relevant comes back, the library does not handle it — build the capability yourself. Finding a service is not a reason to ask the user to connect it yet.',
            inputSchema: z.object({
                query: z.string().describe('Natural-language description of the capability you need (matched semantically, not just by keyword).'),
                category: z.string().optional().describe('Optional category filter.'),
            }),
            execute: ({ query, category }) => call('service_search', { query, category }),
        }),
        rerun_hub_service_details: tool({
            description: 'Get the full details of a service: what it does and which inputs/credentials it needs to be configured.',
            inputSchema: z.object({ slug: z.string() }),
            execute: ({ slug }) => call('service_details', { slug }),
        }),
        rerun_hub_service_install: tool({
            description:
                'Install a service on yourself directly. Use this ONLY for a service that needs no credentials, or when you already hold every required value. If the service needs credentials or a sign-in, do NOT use this — call suggest_service instead so the user sets it up in a card. Returns status "installed" when the service is ready to use; its tools become available on your next turn.',
            inputSchema: z.object({
                slug: z.string(),
                values: z.record(z.string(), z.string()).optional().describe('Optional NON-secret input values to apply directly (e.g. a region or account name).'),
            }),
            execute: ({ slug, values }) => call('service_install', { slug, values }),
        }),
        rerun_hub_service_list_installed: tool({
            description: 'List the services currently installed on you and their status.',
            inputSchema: z.object({}),
            execute: () => call('service_list_installed', {}),
        }),
        rerun_hub_service_uninstall: tool({
            description: 'Uninstall a service from yourself. Removes everything it added (its tools, credentials and usage skill). Use when a capability is no longer needed.',
            inputSchema: z.object({ slug: z.string() }),
            execute: ({ slug }) => call('service_uninstall', { slug }),
        }),
        rerun_hub_publish_file: tool({
            description:
                'Publish a file or folder from your workspace to a URL the user can open. Use it whenever the user needs to see, open or share something you produced (a page, site, report, chart, PDF, export) instead of saying it is in your workspace. Returns the URL and who can open it. Served as-is, so make it final. A page or site gets its own address (https://<slug>.rerun.site) with a "Made with Rerun" badge. For several pages, publish the FOLDER with an index.html at its root; never inline images as base64. Re-publishing a path keeps its URL and access. The url of a single file opens a viewer page: give fileUrl, the file itself, to a service that downloads it (an image Instagram fetches). A public link may wait for a person to approve it: say so when the result does.',
            inputSchema: z.object({
                path: z.string().describe('Path to the file or folder in your workspace, e.g. "reports/q2.pdf" or "sites/launch" (a folder needs an index.html at its root).'),
                slug: z.string().optional().describe('Optional readable name for the URL (lowercase letters, digits, hyphens). A random suffix is appended: "q2-report" gives "q2-report-k3m9xqw7pt". Share the URL returned, never guess it.'),
                access: z
                    .enum(['public', 'workspace', 'password', 'invited'])
                    .optional()
                    .describe('Who can open it: "workspace" (members, default), "public", "password" or "invited". Omit on a republish to keep it.'),
                invite: z.array(z.string()).optional().describe('For "invited": emails or @domains; visitors confirm by email code.'),
                password: z.string().optional().describe('For "password": tell it to the user, it is never shown again.'),
            }),
            execute: ({ path, slug, access, invite, password }) => call('publish_file', { path, slug, access, invite, password }),
        }),
        rerun_hub_unpublish_file: tool({
            description: 'Remove a file you previously published: deletes the published copy and makes its URL stop working. Identify it by the workspace path you published, or by its slug.',
            inputSchema: z.object({
                path: z.string().optional().describe('The workspace path you originally published.'),
                slug: z.string().optional().describe('Or the slug of the published file.'),
            }),
            execute: ({ path, slug }) => call('unpublish_file', { path, slug }),
        }),
        rerun_hub_list_published: tool({
            description: 'List the files you currently have published, with their URLs, who can open each one and their original workspace paths.',
            inputSchema: z.object({}),
            execute: () => call('list_published', {}),
        }),
        rerun_hub_search_docs: tool({
            description:
                'Search the Rerun documentation (docs.rerun.build) for how Rerun works, its limits, pricing or API. Returns passages with their links: hand the user the one you used. Query in English keywords.',
            inputSchema: z.object({ query: z.string().describe('e.g. "webhook trigger token"') }),
            execute: ({ query }) => call('search_docs', { query }),
        }),
    }
}
