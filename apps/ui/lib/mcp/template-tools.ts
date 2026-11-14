import {
    MIN_TEMPLATE_PRICE_CENTS,
    SEO_DESCRIPTION_MAX_LENGTH,
    SEO_DESCRIPTION_MIN_LENGTH,
    TEMPLATE_CATEGORIES,
    TEMPLATE_PRICING_MODELS,
    TEMPLATE_TITLE_MAX_LENGTH,
} from '@rerun/contracts'

export const TEMPLATE_TOOL_DEFS = [
    {
        name: 'list_templates',
        description:
            'List the templates this account authors: templateId, slug, title, status, pricing, how many coworkers are captured, and why a template is no longer editable when it is. A template is a marketplace listing built from real coworkers — the page someone installs from, into their own workspace. Statuses: "draft" (yours, editable), "in_review" (handed over, frozen), "published" / "unlisted" (live, ours to maintain from then on), "archived". Call this first: every other template tool takes the templateId it returns.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'get_template',
        description:
            'One template in full: the editorial document (title, tagline, long description, category, tags, gallery, FAQ, SEO meta, pricing), the coworkers already captured with their `key` (which is what remove_template_agent takes, not a coworker id), and `submitChecklist` — the exact list submit_template enforces, each item with met true/false, plus `readyToSubmit` and `missing`. Read it before every update: update_template only touches the fields you pass, so this is how you know what is already written, and the checklist names what is still missing instead of letting you discover it at submission.',
        inputSchema: {
            type: 'object',
            properties: { templateId: { type: 'string' } },
            required: ['templateId'],
        },
    },
    {
        name: 'create_template',
        description:
            'Create an empty draft from a title. The slug — the public URL of the page — is derived from that title, deduplicated, and belongs to Rerun from then on: it is not editable, so treat the title as the product name. Nothing becomes public here; a draft stays private until submit_template hands it over and the team approves it. The usual sequence after this: update_template for the copy, capture_template_agents for the coworkers, add_template_image for the cover, get_template to read the checklist, submit_template.',
        inputSchema: {
            type: 'object',
            properties: {
                title: {
                    type: 'string',
                    maxLength: TEMPLATE_TITLE_MAX_LENGTH,
                    description: `The product name of the template, ${TEMPLATE_TITLE_MAX_LENGTH} characters maximum, e.g. "Inbound lead qualifier".`,
                },
            },
            required: ['title'],
        },
    },
    {
        name: 'update_template',
        description:
            'Write the editorial page of a draft. Only the fields you pass change, so a one-field call is normal and cheap. This is the whole copy surface: `tagline` is the single line every card shows, `longDescription` is markdown and IS the page, `faq` feeds a FAQPage block search engines read (4 to 6 questions, written the way someone types them into a search box), `metaTitle` / `metaDescription` are the search snippet. Pricing lives here too: `pricingModel` "free", "one_time" (charged once) or "recurring" (monthly), with `priceAmountCents` at 0 when free and at least ' +
            `${MIN_TEMPLATE_PRICE_CENTS}` +
            ' ($5) when paid — any other combination is refused rather than silently stored. Three traps: `tags`, `gallery` and `faq` replace the whole list, so passing `gallery` here DROPS the images already on the template (add_template_image is how you add one); a template in review or published is read-only, and withdraw_template is the way back; status, slug, creator, featured and the visibility flags are deliberately not writable, they are ours.',
        inputSchema: {
            type: 'object',
            properties: {
                templateId: { type: 'string' },
                title: { type: 'string', maxLength: TEMPLATE_TITLE_MAX_LENGTH, description: `The catalogue title, ${TEMPLATE_TITLE_MAX_LENGTH} characters maximum.` },
                tagline: { type: 'string', description: 'One line, up to ~160 characters. The card subtitle.' },
                longDescription: { type: 'string', description: 'The body of the page, in markdown.' },
                category: { type: 'string', enum: [...TEMPLATE_CATEGORIES], description: 'The audience the template is for, not the team that built it.' },
                tags: { type: 'array', items: { type: 'string' }, description: 'Replaces the whole list.' },
                setupMinutes: { type: 'number', description: 'Honest minutes to install it and connect the accounts. Shown on the page.' },
                gallery: {
                    type: 'array',
                    description: 'Replaces the WHOLE gallery, cover first. Prefer add_template_image unless you are reordering or rewriting alt text.',
                    items: { type: 'object', properties: { url: { type: 'string' }, alt: { type: 'string' } }, required: ['url'] },
                },
                videoUrl: { type: 'string', description: 'Optional demo video URL.' },
                faq: {
                    type: 'array',
                    description: 'Replaces the whole FAQ. 4 to 6 entries reads best.',
                    items: { type: 'object', properties: { question: { type: 'string' }, answer: { type: 'string' } }, required: ['question', 'answer'] },
                },
                metaTitle: { type: 'string', description: 'Search title, ~60 characters.' },
                metaDescription: {
                    type: 'string',
                    description: `Search snippet, ${SEO_DESCRIPTION_MIN_LENGTH} to ${SEO_DESCRIPTION_MAX_LENGTH} characters. Required in that range before the template can be submitted or published.`,
                },
                pricingModel: { type: 'string', enum: [...TEMPLATE_PRICING_MODELS] },
                priceAmountCents: { type: 'number', description: `Cents. 0 when free, at least ${MIN_TEMPLATE_PRICE_CENTS} when paid.` },
            },
            required: ['templateId'],
        },
    },
    {
        name: 'submit_template',
        description:
            `Hand a draft to the Rerun team for review. It enforces the list get_template returns — a title, a tagline, a description, a meta description of ${SEO_DESCRIPTION_MIN_LENGTH} to ${SEO_DESCRIPTION_MAX_LENGTH} characters, at least one captured coworker, an install answer for every coworker, and for a paid template a Stripe account that can actually receive payouts — and names what is missing instead of half-submitting. It also refuses on a credential found anywhere in the copy, because this is the last moment the author can still fix what they pasted. Once it succeeds the template is frozen: still private, no longer editable, and withdraw_template is the only way back to a draft. Publishing is the team's decision, never this tool's. Payout onboarding cannot happen from here: it needs a browser, in the Rerun app, board toolbar, "My templates", Payouts.`,
        inputSchema: {
            type: 'object',
            properties: { templateId: { type: 'string' } },
            required: ['templateId'],
        },
    },
    {
        name: 'withdraw_template',
        description:
            'Take a template back from review into draft so it can be edited again. Only works while it is in_review — once published, the page is ours to maintain and this is refused. Resubmitting afterwards is a fresh submit_template.',
        inputSchema: {
            type: 'object',
            properties: { templateId: { type: 'string' } },
            required: ['templateId'],
        },
    },
    {
        name: 'delete_template',
        description: 'Permanently delete a draft template. Irreversible, and refused on a template in review or already published. Requires confirm: true.',
        inputSchema: {
            type: 'object',
            properties: { templateId: { type: 'string' }, confirm: { type: 'boolean' } },
            required: ['templateId', 'confirm'],
        },
    },
    {
        name: 'list_capture_sources',
        description:
            'List the Boxes and coworkers that can be captured into a template — the sandbox only, and only coworkers the engine actually knows about. The coworker ids returned here are what plan_template_capture and capture_template_agents take. A template can only be built from sandbox coworkers by design: capturing from a working workspace would publish a client\'s memory files.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'plan_template_capture',
        description:
            'Dry run: inspect what capturing these coworkers would ship, without writing anything. Returns, per coworker, its skills, scheduled tasks, webhook triggers, declared apps, the `.env` key NAMES a copy will have to be given again (names only, never values), the MCP servers whose sign-in stays behind, how many memory files it holds, what the engine will redact on the way out, and `excludedByDefault` — the paths the engine considers too personal to publish. Read it before capturing: this is the security review, and the archive ends up behind a public install button.',
        inputSchema: {
            type: 'object',
            properties: {
                templateId: { type: 'string' },
                spaceId: { type: 'string', description: 'From list_capture_sources.' },
                agentIds: { type: 'array', items: { type: 'string' }, description: 'Coworker ids from list_capture_sources, in that Box.' },
            },
            required: ['templateId', 'spaceId', 'agentIds'],
        },
    },
    {
        name: 'capture_template_agents',
        description:
            'Capture coworkers from the sandbox into the template: prompt, skills, scheduled tasks, webhook triggers, app declarations and workspace files are archived, and the template page is rewritten from what the folder actually contains, so nothing about the coworkers has to be hand-described. A webhook travels as its instruction and its methods, never as its URL: every copy is issued a secret of its own at install time, so whoever installs the template has to repoint the service that calls it. The paths the engine marks as excluded-by-default (memory, credential folders) are left out unless you name them in `keep`, which is the same default the Rerun app applies — do not keep a memory folder without the account owner asking for it. The coworker database (`data/agent.db`) is NOT excluded by default: its tables ship with their rows, so clear the test rows first or name it in `exclude`. `exclude` drops more paths. Re-capturing a coworker already in the template updates its entry in place rather than adding a second one, and the editorial copy written about it survives. Read the `warnings` that come back: they name literal credentials the engine had to strip.',
        inputSchema: {
            type: 'object',
            properties: {
                templateId: { type: 'string' },
                spaceId: { type: 'string' },
                agents: {
                    type: 'array',
                    description: 'One entry per coworker to capture, e.g. [{"agentId": "…"}].',
                    items: {
                        type: 'object',
                        properties: {
                            agentId: { type: 'string' },
                            exclude: { type: 'array', items: { type: 'string' }, description: 'Extra paths from plan_template_capture to leave out.' },
                            keep: { type: 'array', items: { type: 'string' }, description: 'Paths from `excludedByDefault` to ship anyway. A deliberate act: these are memories and credentials.' },
                            setup: {
                                type: 'object',
                                description:
                                    'The answer to "does this coworker need to be configured after install?", which a template cannot be submitted without. `required: true` means the copy opens on a Start installation button and runs `prompt` on its own to walk its new owner through the setup; `required: false` means it works out of the box. Written to the coworker before its folder is archived, so it travels with the copy.',
                                properties: {
                                    required: { type: 'boolean' },
                                    prompt: { type: 'string', description: 'Addressed to the coworker, not to the user: what to check, what to ask for with ask_user, what to test. Required when `required` is true.' },
                                },
                                required: ['required'],
                            },
                        },
                        required: ['agentId'],
                    },
                },
            },
            required: ['templateId', 'spaceId', 'agents'],
        },
    },
    {
        name: 'remove_template_agent',
        description:
            'Remove a captured coworker from a template and delete its archive. `agentKey` is the `key` get_template returns for each coworker, not the sandbox coworker id. Apps no remaining coworker uses leave the page with it. Requires confirm: true.',
        inputSchema: {
            type: 'object',
            properties: { templateId: { type: 'string' }, agentKey: { type: 'string' }, confirm: { type: 'boolean' } },
            required: ['templateId', 'agentKey', 'confirm'],
        },
    },
    {
        name: 'add_template_image',
        description:
            'Add one image to the template gallery from a URL that is already hosted somewhere public. The bytes are downloaded and re-encoded into Rerun\'s own storage, so the gallery never points at a host that can expire or swap the picture after the review, and the URL you pass is not what gets stored. Pass `cover: true` to put it first, which is the one every card and the social preview use. Unlike update_template(gallery) this appends: the images already there are kept. Write `alt`, it is read by search engines and screen readers. There is no upload and no image generation here — produce or host the image elsewhere, then pass its https URL.',
        inputSchema: {
            type: 'object',
            properties: {
                templateId: { type: 'string' },
                imageUrl: { type: 'string', description: 'Public https URL of an image (png, jpg, webp).' },
                alt: { type: 'string', description: 'What the image shows, one sentence.' },
                cover: { type: 'boolean', description: 'Put it first, making it the cover and the social preview.' },
            },
            required: ['templateId', 'imageUrl'],
        },
    },
] as const
