import { PUBLISHED_ACCESS_MODES } from '@/lib/published/access'

// The files and pages the coworkers put online: a file of a coworker folder, or a folder with an
// index.html served as a site, at its own address. Not to be confused with the share links of
// create_agent_share, which hand out a copy of a coworker.
export const PUBLISH_TOOL_DEFS = [
    {
        name: 'list_published_pages',
        description:
            'List what the coworkers you can reach have published, newest first: each link with its slug, its address (`url`), the file or folder it serves, who it is open to (`access`), whether a coworker asked to make it public (`requestedAccess`), and when it was published. A page reads and writes only the tables it was given: see them with update_published_page.',
        inputSchema: {
            type: 'object',
            properties: { agentId: { type: 'string', description: 'Only the links of this coworker.' } },
        },
    },
    {
        name: 'publish_file',
        description:
            'Put a file of a coworker folder online at an address of its own, the way Publish does in its Files tab: a PDF, an image or a report as a file, an HTML file or a folder holding an index.html as a page. It opens with the access the workspace gives a new link; change who can open it, and the tables a page may read or write, with update_published_page. Publishing the same path again replaces what the link serves and keeps its address.',
        inputSchema: {
            type: 'object',
            properties: {
                agentId: { type: 'string' },
                path: { type: 'string', description: 'The file or folder in the coworker folder, as list_files gives it, e.g. "site" or "reports/q1.pdf".' },
            },
            required: ['agentId', 'path'],
        },
    },
    {
        name: 'update_published_page',
        description: `Change who can open a published link, and which tables of the workspace a page reads or writes. \`access\` is one of ${PUBLISHED_ACCESS_MODES.join(', ')}: public is anyone with the address (refused when the workspace turned public links off), workspace its signed-in members, password anyone who types the password you set, invited the addresses in invite, who confirm theirs with a code sent to it. \`tables\` replaces the whole list of tables the page reaches: pass [] to take them all away. Every field is optional: pass the slug alone to read the tables the page reaches (listed) and the ones it could be given (others) without changing anything. The answer carries \`tables\` when you passed them or the slug alone.`,
        inputSchema: {
            type: 'object',
            properties: {
                slug: { type: 'string', description: 'From list_published_pages or publish_file.' },
                access: { type: 'string', enum: [...PUBLISHED_ACCESS_MODES] },
                invite: { type: 'array', items: { type: 'string' }, description: 'For access invited: the email addresses who may open it.' },
                password: { type: 'string', description: 'For access password: the password to open it. Never returned afterwards.' },
                tables: {
                    type: 'array',
                    description: 'For a page or a site: every table it may reach, e.g. [{"database": "shared", "table": "leads", "grant": "read"}]. `database` is "shared" for the database every coworker shares, or the id of the coworker whose own database holds the table.',
                    items: {
                        type: 'object',
                        properties: { database: { type: 'string' }, table: { type: 'string' }, grant: { type: 'string', enum: ['read', 'write'] } },
                        required: ['database', 'table', 'grant'],
                    },
                },
            },
            required: ['slug'],
        },
    },
    {
        name: 'unpublish_page',
        description: 'Take a published link down: its address stops answering at once, and publishing the file again gives it a new one. The file itself stays in the coworker folder. Requires confirm: true.',
        inputSchema: {
            type: 'object',
            properties: { slug: { type: 'string' }, confirm: { type: 'boolean' } },
            required: ['slug', 'confirm'],
        },
    },
] as const
