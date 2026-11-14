export const SHARE_TOOL_DEFS = [
    {
        name: 'plan_agent_share',
        description:
            'Dry run before sending an agent: what a share link would carry, without creating one. Returns the three data buckets priced — its memories, its own database, its workspace files — with a count and a size each, how many .env keys and MCP sign-ins the copy will have to be given again (counts only, never names, never values), and warnings naming the literal credentials the engine strips on the way out. None of the three buckets travels unless you name it in create_agent_share, and the Box database and the Box shared files never travel at all: a copy starts with empty ones. Read this before creating a link — it is how you tell the account owner what a switch would actually send.',
        inputSchema: {
            type: 'object',
            properties: { agentId: { type: 'string' } },
            required: ['agentId'],
        },
    },
    {
        name: 'create_agent_share',
        description:
            `Create a link that hands one coworker to someone else: they open it, sign in, and a copy lands on their board with its apps disconnected and its webhooks reissued. Four things about it that are not obvious. The link is a bearer capability with no expiry and no password, so whoever holds the URL can install the coworker until it is revoked — hand it only to the person it is for. The copy is frozen at this call: it never grows afterwards, and renaming, switching off or deleting the source coworker does not change what was sent. \`include\` is empty by default — instructions, skills, scheduled tasks and webhooks are the coworker and travel either way, the three switches are all data belonging to the account owner, and turning any of them on requires confirm: true. Calling this twice on the same coworker with the same \`include\` hands back the link that already exists rather than taking a second snapshot, and says so with reused: true. Whatever you pass, the Box database and the Box shared files stay here, and API keys, connected accounts and chat history never leave the workspace. This streams the coworker folder off its Box, so it is not instant.`,
        inputSchema: {
            type: 'object',
            properties: {
                agentId: { type: 'string' },
                include: {
                    type: 'object',
                    description: 'What data the copy carries. Everything left out stays in this workspace. Any of these set to true needs confirm: true.',
                    properties: {
                        memories: { type: 'boolean', description: 'What the coworker has learned and written down about the people and the work it serves.' },
                        database: { type: 'boolean', description: 'The private SQLite database of this coworker, with every row it holds.' },
                        files: { type: 'boolean', description: 'The files in the coworker workspace folder: documents, exports, whatever it has produced or been given.' },
                    },
                },
                confirm: { type: 'boolean' },
            },
            required: ['agentId'],
        },
    },
    {
        name: 'list_agent_shares',
        description:
            'The share links this workspace currently has out: shareId, the URL itself, the coworker it was made from, when it was made, how many times it has been installed, and what data each one carries. This is the only way to get a link back after create_agent_share returned it, and the only way to see what is still reachable from outside. Every URL listed here is live — anyone holding one can still install the coworker — so do not paste them anywhere they outlive this conversation. Revoked links are not listed. agentId comes back null once the source coworker has been deleted: the link keeps working, the snapshot never depended on it. shareId is what revoke_agent_share takes.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'revoke_agent_share',
        description:
            'Kill a share link and delete the archive behind it. Immediate and irreversible: the URL stops working for everyone holding it, including someone in the middle of installing, and the same URL can never be reissued — a new link means a fresh create_agent_share and a fresh snapshot. Coworkers already installed from it are untouched, they belong to whoever installed them. shareId comes from list_agent_shares, never from the URL. Requires confirm: true.',
        inputSchema: {
            type: 'object',
            properties: { shareId: { type: 'string' }, confirm: { type: 'boolean' } },
            required: ['shareId', 'confirm'],
        },
    },
] as const
