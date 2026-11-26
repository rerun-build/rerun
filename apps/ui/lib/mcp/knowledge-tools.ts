import { BRAIN_CARD_TYPES, BRAIN_ENTITY_TYPES, TEXT_FILE_PAGE_CHARS } from '@rerun/contracts'

export const MAX_MEMORIES_LISTED = 200
export const MAX_MEMORIES_RECALLED = 20
export const MAX_BRAIN_PAGE_CHARS = 60_000

const BRAIN_PAGE_TYPES = [...BRAIN_CARD_TYPES, ...BRAIN_ENTITY_TYPES]

// What a coworker and the workspace know: the memories of a coworker, the pages of the Brain every
// coworker reads, and the files they work from. The read side of write_memory and
// upload_workspace_file, which sit with the coworker tools.

const FILE_LOCATION_PROPERTIES = {
    agentId: { type: 'string', description: "The coworker whose own folder to read. Leave it out with shared: true to read the workspace's shared folder instead." },
    shared: { type: 'boolean', description: 'True for the folder every coworker of the workspace shares (the Files of the Brain), instead of one coworker folder.' },
} as const

export const KNOWLEDGE_TOOL_DEFS = [
    {
        name: 'list_memories',
        description: `List what a coworker remembers, newest first: each memory with its id, kind, tags, content and when it was written. Filter by kind or tag, and page through with offset: up to ${MAX_MEMORIES_LISTED} per call, and \`total\` says how many match. Use recall_memories to find the memories about a subject rather than reading them all.`,
        inputSchema: {
            type: 'object',
            properties: {
                agentId: { type: 'string' },
                kind: { type: 'string', description: 'preference | fact | learned | note | task.' },
                tag: { type: 'string' },
                limit: { type: 'number', description: `Default 50, max ${MAX_MEMORIES_LISTED}.` },
                offset: { type: 'number', description: 'Default 0.' },
            },
            required: ['agentId'],
        },
    },
    {
        name: 'recall_memories',
        description: `Find the memories of a coworker about a subject, the way it recalls them itself during a run: by meaning, best match first. Reading them here does not count as the coworker using them. Up to ${MAX_MEMORIES_RECALLED} per call.`,
        inputSchema: {
            type: 'object',
            properties: {
                agentId: { type: 'string' },
                query: { type: 'string', description: 'What to look for, in plain words, e.g. "how the owner wants the weekly report".' },
                limit: { type: 'number', description: `Default 5, max ${MAX_MEMORIES_RECALLED}.` },
            },
            required: ['agentId', 'query'],
        },
    },
    {
        name: 'delete_memory',
        description: 'Delete one memory of a coworker by its id, from list_memories or recall_memories. A memory cannot be edited in place: to correct one, delete it and write the right version with write_memory, which gives it a new id. Requires confirm: true.',
        inputSchema: {
            type: 'object',
            properties: { agentId: { type: 'string' }, memoryId: { type: 'string' }, confirm: { type: 'boolean' } },
            required: ['agentId', 'memoryId', 'confirm'],
        },
    },
    {
        name: 'list_files',
        description: 'List one folder of a coworker workspace folder, or of the folder every coworker of the workspace shares: each entry with its name, whether it is a file or a folder, and its size in bytes. One level at a time, folders first: pass the path of a folder to go down into it.',
        inputSchema: {
            type: 'object',
            properties: {
                ...FILE_LOCATION_PROPERTIES,
                path: { type: 'string', description: 'The folder to list, relative to the root, e.g. "reports/2026". Defaults to the root.' },
            },
        },
    },
    {
        name: 'read_file',
        description: `Read one ${TEXT_FILE_PAGE_CHARS.toLocaleString('en-US')}-character page of a text file of a coworker folder or of the shared folder (markdown, CSV, JSON, code, HTML…). The answer carries nextOffset when more remains: call again with it to read on. An image, a PDF or any other binary file is not read here: open it in the Rerun app.`,
        inputSchema: {
            type: 'object',
            properties: {
                ...FILE_LOCATION_PROPERTIES,
                path: { type: 'string', description: 'Path of the file, as list_files gives it, e.g. "reports/2026/q1.md".' },
                offset: { type: 'integer', minimum: 0, description: 'Character offset to start at. Omit or pass 0 for the first page; use nextOffset to continue.' },
            },
            required: ['path'],
        },
    },
    {
        name: 'list_brain_pages',
        description:
            'List the pages of the Brain: what the company is, sells, who it sells to, how it speaks, its customers, competitors, people and decisions, written once and read by every coworker of the workspace. Each page gives its slug, title, type, tags, the Box it is filed under (null for everyone), who changed it last and when, and its hash. Read one in full with get_brain_page.',
        inputSchema: {
            type: 'object',
            properties: {
                type: { type: 'string', enum: BRAIN_PAGE_TYPES, description: 'Only the pages of this type.' },
                spaceId: { type: 'string', description: 'Only the pages filed under this Box.' },
            },
        },
    },
    {
        name: 'get_brain_page',
        description: 'Read one page of the Brain in full: its markdown content, its sources, the pages it links to and the ones linking to it, its `hash` (what write_brain_page needs to change it) and its history of revisions, newest first.',
        inputSchema: {
            type: 'object',
            properties: { slug: { type: 'string' } },
            required: ['slug'],
        },
    },
    {
        name: 'write_brain_page',
        description: `Create a page of the Brain, or rewrite one. Every coworker of the workspace reads it from its next run. To create, pass baseHash: null and a new slug. To change a page, read it with get_brain_page and pass its hash as baseHash along with the whole new content: the write replaces the page, and is refused when someone changed it since you read it, in which case read it again and redo your change on what it says now. The revision is signed with the name of the member who created this key. Content is markdown, ${MAX_BRAIN_PAGE_CHARS.toLocaleString('en-US')} characters at most.`,
        inputSchema: {
            type: 'object',
            properties: {
                slug: { type: 'string', description: 'Lowercase kebab-case, 64 characters at most, e.g. "pricing" or "acme-corp".' },
                title: { type: 'string', description: '120 characters at most.' },
                type: { type: 'string', enum: BRAIN_PAGE_TYPES, description: 'company, offering, market, team, voice, stack and priorities are the cards of the company; customer, competitor, person, product, decision and note are pages about one thing.' },
                content: { type: 'string', description: 'The whole page, in markdown.' },
                sources: { type: 'array', items: { type: 'string' }, description: 'Where the facts come from: URLs or file paths, 50 at most.' },
                baseHash: { type: ['string', 'null'], description: 'null to create the page; the hash from get_brain_page to change it.' },
                spaceId: { type: 'string', description: 'File the page under this Box, so it reads as belonging to that team. Leave it out to keep it for everyone.' },
            },
            required: ['slug', 'title', 'type', 'content', 'baseHash'],
        },
    },
    {
        name: 'delete_brain_page',
        description: 'Delete a page of the Brain: no coworker reads it any more, and the links to it from other pages break. Requires confirm: true.',
        inputSchema: {
            type: 'object',
            properties: { slug: { type: 'string' }, confirm: { type: 'boolean' } },
            required: ['slug', 'confirm'],
        },
    },
] as const
