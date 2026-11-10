import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { AGENT_FOCUS_TABS, AGENT_TAB_LABELS, resolveTab } from '@/lib/board/types'
import { SETTINGS_PANELS, SETTINGS_PANEL_LABELS } from '@/lib/settings/panels'
import { WrenchIcon } from '@/lib/icons'
import { toolIconOf } from '@/lib/tool-meta'
import { ACCOUNT_TOOL_NAMES } from '@/lib/mcp/account-tools'
import { ALL_PLAN_KINDS, FOREMAN_BOX_TOOL_DEFS, FOREMAN_ONBOARDING_TOOL_DEFS, FOREMAN_WIDGET_TOOL_DEFS, FOREMAN_CLIENT_TOOL_DEFS, FOREMAN_CLIENT_TOOL_NAMES, FOREMAN_MCP_TOOL_NAMES, FOREMAN_TOOL_DEFS, FOREMAN_TOOL_NAMES, showPlanDef, showTemplatesDef } from './tool-defs'

// The belts are assembled from places that know nothing about each other: names borrowed from the
// MCP server, Box tools dispatched onto server actions, and tools the browser resolves. A name that
// drifts in any of them fails silently at runtime, as a tool the model calls and nobody answers, so
// the seams are checked here.

const boxHandlerNames = [...readFileSync(path.resolve(import.meta.dirname, 'box-tools.ts'), 'utf8').matchAll(/case '([a-z_]+)':/g)].map(match => match[1])

const onboardingHandlerSource = readFileSync(path.resolve(import.meta.dirname, 'onboarding-tools.ts'), 'utf8')

const clientHandlerSource = readFileSync(path.resolve(import.meta.dirname, '../../components/foreman/foremanClientTools.ts'), 'utf8')

const widgetRendererSource = readFileSync(path.resolve(import.meta.dirname, '../../components/foreman/widgets/renderForemanWidget.tsx'), 'utf8')

type PlanSchema = { properties: { items: { items: { properties: Record<string, { enum?: string[] }> } } } }

describe('foreman tool defs', () => {
    it('declares every name once', () => {
        expect([...new Set(FOREMAN_TOOL_NAMES)]).toHaveLength(FOREMAN_TOOL_NAMES.length)
    })

    it('only borrows names the MCP server really serves', () => {
        expect(FOREMAN_MCP_TOOL_NAMES.filter(name => !ACCOUNT_TOOL_NAMES.includes(name))).toEqual([])
    })

    // The onboarding gets to know them and lays a plan out: everything that acts on the workspace is
    // the engine foreman's, once the build has claimed the machine.
    it('hands the onboarding belt nothing that acts on the workspace', () => {
        const workspaceTools = [...FOREMAN_MCP_TOOL_NAMES, ...FOREMAN_BOX_TOOL_DEFS.map(def => def.name), 'install_template', 'install_shared_agent', 'start_agent_setup', 'list_templates']
        expect(workspaceTools.filter(name => (FOREMAN_TOOL_NAMES as readonly string[]).includes(name))).toEqual([])
    })

    it('has a handler for every Box tool', () => {
        expect(FOREMAN_BOX_TOOL_DEFS.map(def => def.name).filter(name => !boxHandlerNames.includes(name))).toEqual([])
    })

    it('has a handler for every onboarding tool', () => {
        expect(FOREMAN_ONBOARDING_TOOL_DEFS.map(def => def.name).filter(name => !onboardingHandlerSource.includes(`case '${name}':`))).toEqual([])
    })

    it('has a browser handler for every client tool', () => {
        expect(FOREMAN_CLIENT_TOOL_NAMES.filter(name => !clientHandlerSource.includes(`case '${name}':`))).toEqual([])
    })

    it('draws a widget for every widget tool', () => {
        expect(FOREMAN_WIDGET_TOOL_DEFS.map(def => def.name).filter(name => !widgetRendererSource.includes(`case '${name}':`))).toEqual([])
    })

    // The plan card is the only tool whose schema depends on the conversation: what the model can
    // write down is narrowed to what it can really land, and a funnel that never met a ready-made
    // team must not read that a template item exists at all.
    it('offers the plan kinds the conversation can land, and no others', () => {
        for (const def of [showPlanDef(['agent'])]) {
            const properties = (def.inputSchema as PlanSchema).properties.items.items.properties
            expect(properties.kind.enum).toEqual(['agent'])
            expect(properties.slug).toBeUndefined()
            expect(properties.title).toBeUndefined()
            expect(properties.token).toBeUndefined()
            expect(properties.name).toBeDefined()
        }

        for (const def of [showPlanDef(ALL_PLAN_KINDS)]) {
            const properties = (def.inputSchema as PlanSchema).properties.items.items.properties
            expect(properties.kind.enum).toEqual(['agent', 'template', 'share'])
            expect(properties.slug).toBeDefined()
            expect(properties.token).toBeDefined()
        }
    })

    // During the onboarding the Boxes are the ones the welcome card drew: the model is handed no
    // way to write one, only the names it may file an agent under.
    it('asks for agents only once the Boxes are pinned', () => {
        const pinned = showPlanDef(['agent'], ['Sales', 'Marketing']).inputSchema as PlanSchema & { properties: { boxes?: unknown }; required: string[] }
        expect(pinned.properties.boxes).toBeUndefined()
        expect(pinned.required).toEqual(['title', 'items'])
        expect(pinned.properties.items.items.properties.box.enum).toEqual(['Sales', 'Marketing'])
        expect((pinned.properties.items.items as { required?: string[] }).required).toEqual(['kind', 'box'])

        const free = showPlanDef(['agent']).inputSchema as PlanSchema & { properties: { boxes?: unknown }; required: string[] }
        expect(free.properties.boxes).toBeDefined()
        expect(free.properties.items.items.properties.box.enum).toBeUndefined()
    })

    it('lands a template card in one of the pinned Boxes', () => {
        type TemplatesSchema = { properties: { box: { enum?: string[] } } }
        expect((showTemplatesDef(['Sales', 'Marketing']).inputSchema as TemplatesSchema).properties.box.enum).toEqual(['Sales', 'Marketing'])
        expect((showTemplatesDef().inputSchema as TemplatesSchema).properties.box.enum).toBeUndefined()
    })

    it('describes what each tool does, for the calling model', () => {
        expect(FOREMAN_TOOL_DEFS.filter(def => def.description.length < 40).map(def => def.name)).toEqual([])
    })

    it('lets focus_agent reach every tab of the agent panel, and says what each one shows', () => {
        const focusAgent = FOREMAN_CLIENT_TOOL_DEFS.find(def => def.name === 'focus_agent')!
        expect(focusAgent.inputSchema.properties.tab.enum).toEqual([...AGENT_FOCUS_TABS])
        expect(AGENT_FOCUS_TABS.filter(tab => !focusAgent.description.includes(`\`${tab}\` ("${AGENT_TAB_LABELS[tab]}"`))).toEqual([])
    })

    // Without it the chat tab opens on a blank composer while the run the foreman just started
    // plays in a conversation the user never sees.
    it('lets focus_agent name the conversation to land on', () => {
        const focusAgent = FOREMAN_CLIENT_TOOL_DEFS.find(def => def.name === 'focus_agent')!
        expect(focusAgent.inputSchema.properties.conversationId).toBeDefined()
        expect(focusAgent.inputSchema.required).toEqual(['agentId', 'tab'])
    })

    // The row is what replaced the panel the assistant used to open on its own: it has to carry
    // everything focus_agent did, or the chat it leads to is an empty one.
    it('lets a show_agents row lead to a tab and to a running conversation', () => {
        const showAgents = FOREMAN_CLIENT_TOOL_DEFS.find(def => def.name === 'show_agents')!
        const row = showAgents.inputSchema.properties.agents.items
        expect(row.properties.tab.enum).toEqual([...AGENT_FOCUS_TABS])
        expect(row.properties.conversationId).toBeDefined()
        expect(row.properties.runId).toBeDefined()
        expect(row.required).toEqual(['agentId'])
    })

    it('lets open_settings reach every account panel, under the name the user reads', () => {
        const openSettings = FOREMAN_CLIENT_TOOL_DEFS.find(def => def.name === 'open_settings')!
        expect(openSettings.inputSchema.properties.panel.enum).toEqual([...SETTINGS_PANELS])
        expect(SETTINGS_PANELS.filter(panel => !openSettings.description.includes(`\`${panel}\` ("${SETTINGS_PANEL_LABELS[panel]}"`))).toEqual([])
    })

    // toolIconOf never fails, it falls back to a title-cased name under a wrench. That fallback is
    // right for an unknown MCP tool and wrong for ours, so the assertion is on the icon.
    it('gives every tool a label of its own in the chat', () => {
        expect(FOREMAN_TOOL_NAMES.filter(name => toolIconOf(name) === WrenchIcon)).toEqual([])
    })
})

describe('resolveTab', () => {
    it('takes the id or the label, whatever the case', () => {
        expect(resolveTab('files', AGENT_TAB_LABELS)).toBe('files')
        expect(resolveTab('Files', AGENT_TAB_LABELS)).toBe('files')
        expect(resolveTab('apps', AGENT_TAB_LABELS)).toBe('services')
        expect(resolveTab(' Routines ', AGENT_TAB_LABELS)).toBe('scheduled')
        expect(resolveTab('knowledge', AGENT_TAB_LABELS)).toBe('memories')
        expect(resolveTab('AI providers', SETTINGS_PANEL_LABELS)).toBe('ai_providers')
    })

    it('answers null for a tab that does not exist', () => {
        expect(resolveTab('overview', SETTINGS_PANEL_LABELS)).toBeNull()
    })
})

describe('the discovery schemas', () => {
    const widget = (name: string) => FOREMAN_WIDGET_TOOL_DEFS.find(def => def.name === name) as { inputSchema: { properties: Record<string, { type?: string }>; required?: string[] } }
    const onboarding = (name: string) => FOREMAN_ONBOARDING_TOOL_DEFS.find(def => def.name === name) as { inputSchema: { properties: Record<string, { type?: string; items?: { type?: string } }> } }

    // The multiple flag is what turns the one question of the funnel into a list they tick. The
    // form has always known how to render it; without it in the schema the model cannot ask for it.
    it('lets ask_choice be asked as a list to tick, and does not demand it', () => {
        const schema = widget('ask_choice').inputSchema
        expect(schema.properties.multiple?.type).toBe('boolean')
        expect(schema.required).not.toContain('multiple')
    })

    // Two buttons is the whole card: a third answer has nowhere to be drawn.
    it('asks ask_either for a title, a line and exactly two answers', () => {
        const schema = widget('ask_either').inputSchema as { properties: Record<string, { minItems?: number; maxItems?: number }>; required?: string[] }
        expect(schema.required).toEqual(['title', 'description', 'options'])
        expect(schema.properties.options).toMatchObject({ minItems: 2, maxItems: 2 })
    })

    it('asks an agent for the day it plays on the card and for what it hands over', () => {
        const properties = (showPlanDef(['agent'], ['Sales']).inputSchema as { properties: { items: { items: { properties: { beats: { required: string[] }; gets: { maxItems: number } } } } } }).properties.items.items.properties
        expect(properties.beats.required).toEqual(['trigger', 'working', 'delivered'])
        expect(properties.gets.maxItems).toBe(3)
    })

    it('holds a designed plan to one job', () => {
        const plan = showPlanDef(['agent']).inputSchema as { properties: { items: { maxItems?: number } } }
        expect(plan.properties.items.maxItems).toBe(1)
    })

    it('takes every ticked job on save_profile', () => {
        const schema = onboarding('save_profile').inputSchema
        expect(schema.properties.use_cases?.type).toBe('array')
        expect(schema.properties.use_cases?.items?.type).toBe('string')
    })

    // Kept declared rather than removed: the rows in production carry it, and a model that sends it
    // anyway must not trip the schema on the one call that closes discovery.
    it('still accepts the single pain a profile used to carry', () => {
        expect(onboarding('save_profile').inputSchema.properties.pain?.type).toBe('string')
    })
})
