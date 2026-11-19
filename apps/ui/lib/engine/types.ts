import { z } from 'zod'
import type { GettingStartedItem } from '@/lib/onboarding/getting-started'
import {
    toolsSchema,
    toolDescriptorSchema,
    toolFamilySchema,
    toolsListSchema,
    selfImprovementSchema,
    mcpServerSchema,
    mcpServerStatusListSchema,
    type McpServerStatus,
    mcpSessionStateListSchema,
    mcpReconnectResultSchema,
    mcpServerToolListSchema,
    type McpServerToolList,
    type McpSessionState,
    type McpReconnectResult,
    agentConfigSchema,
    agentDetailSchema,
    activatedAutomationsSchema,
    agentKeysListSchema,
    connectionSummarySchema,
    connectionsListSchema,
    boxDefaultModelSchema as engineBoxDefaultModelSchema,
    connectionUsageSchema as engineConnectionUsageSchema,
    deleteConnectionResultSchema as engineDeleteConnectionResultSchema,
    sessionSchema,
    sessionsListSchema,
    messageSchema,
    messagesListSchema,
    memorySchema,
    memoriesListSchema,
    fileEntrySchema,
    fileEntriesListSchema,
    fileContentSchema,
    skillSchema,
    skillsListSchema,
    skillProposalSchema,
    skillProposalsListSchema,
    scheduleSchema,
    schedulesListSchema,
    triggerSchema,
    triggersListSchema,
    runSchema,
    runsListSchema,
    runDetailSchema,
    runResultSchema,
    runStepSchema,
    runStepsListSchema,
    toolCallSchema,
    toolCallsListSchema,
} from '@moldwright/contracts'
import type {
    Tools,
    ToolDescriptor,
    ToolFamily,
    SelfImprovement,
    McpServer,
    Provider,
    Verbosity,
    AgentConfig,
    AgentSetup,
    AgentDetail,
    AgentKeysList,
    Session,
    SessionSource,
    Message,
    Memory,
    FileEntry,
    FileContent,
    Skill,
    SkillProposal,
    SkillFilePayload,
    ConnectionSummary,
    ConnectionsList,
    ConnectionUsage,
    BoxDefaultModel,
    CreateConnectionInput,
    UpdateConnectionInput,
    Schedule,
    Trigger,
    TriggerMethod,
    Run,
    RunDetail,
    RunResult,
    RunStep,
    RunStepsList,
    ToolCall,
    ToolCallsList,
} from '@moldwright/contracts'

export type EngineConnection = {
    baseUrl: string
    apiKey: string | null
}

export const engineToolsSchema = toolsSchema
export const engineToolDescriptorSchema = toolDescriptorSchema
export const engineToolFamilySchema = toolFamilySchema
export const engineToolsListSchema = toolsListSchema
export const engineSelfImprovementSchema = selfImprovementSchema
export const engineMcpServerSchema = mcpServerSchema
export const engineMcpServerStatusListSchema = mcpServerStatusListSchema
export const engineMcpSessionStateListSchema = mcpSessionStateListSchema
export const engineMcpReconnectResultSchema = mcpReconnectResultSchema
export const engineMcpServerToolListSchema = mcpServerToolListSchema
export const engineAgentConfigSchema = agentConfigSchema
export const engineAgentDetailSchema = agentDetailSchema
export const engineActivatedAutomationsSchema = activatedAutomationsSchema
export const engineAgentKeysListSchema = agentKeysListSchema
export const boxConnectionSchema = connectionSummarySchema
export const boxConnectionsListSchema = connectionsListSchema
export const boxDefaultSchema = engineBoxDefaultModelSchema
export const connectionUsageSchema = engineConnectionUsageSchema
export const deleteConnectionResultSchema = engineDeleteConnectionResultSchema
export const engineSessionSchema = sessionSchema
export const engineSessionsListSchema = sessionsListSchema
export const engineMessageSchema = messageSchema
export const engineMessagesListSchema = messagesListSchema
export const engineMemorySchema = memorySchema
export const engineMemoriesListSchema = memoriesListSchema
export const engineFileEntrySchema = fileEntrySchema
export const engineFileEntriesListSchema = fileEntriesListSchema
export const engineFileContentSchema = fileContentSchema
const skillEnabledField = { enabled: z.boolean().default(true) }
export const engineSkillSchema = skillSchema.extend(skillEnabledField)
export const engineSkillsListSchema = z.object({ skills: z.array(engineSkillSchema) })
export const engineSkillEnabledSchema = z.object({ slug: z.string(), enabled: z.boolean() })
export const engineSkillSummarySchema = skillSchema.pick({ slug: true, name: true, description: true }).extend(skillEnabledField)
export const engineSkillSummariesListSchema = z.object({ skills: z.array(engineSkillSummarySchema) })
export const engineSkillProposalSchema = skillProposalSchema
export const engineSkillProposalsListSchema = skillProposalsListSchema
export const engineScheduleSchema = scheduleSchema
export const engineSchedulesListSchema = schedulesListSchema
export const engineTriggerSchema = triggerSchema
export const engineTriggersListSchema = triggersListSchema
export const engineRunSchema = runSchema
export const engineRunsListSchema = runsListSchema
export const engineRunDetailSchema = runDetailSchema
export const engineRunResultSchema = runResultSchema
export const engineRunStepSchema = runStepSchema
export const engineRunStepsListSchema = runStepsListSchema
export const engineToolCallSchema = toolCallSchema
export const engineToolCallsListSchema = toolCallsListSchema

export type EngineTools = Tools
export type EngineToolDescriptor = ToolDescriptor
export type EngineToolFamily = ToolFamily
export type EngineSelfImprovement = SelfImprovement
export type EngineMcpServer = McpServer
export type EngineMcpServerStatus = McpServerStatus
export type EngineMcpSessionState = McpSessionState
export type EngineMcpReconnectResult = McpReconnectResult
export type EngineMcpServerToolList = McpServerToolList
export type EngineToolList = { families: EngineToolFamily[]; promptTokens?: number }
export type EngineAgentConfig = AgentConfig
export type EngineAgentConfigPatch = Partial<Omit<AgentConfig, 'tools' | 'selfImprovement' | 'setup'>> & {
    tools?: Record<string, boolean>
    selfImprovement?: Partial<SelfImprovement>
    setup?: Partial<AgentSetup>
}
export type EngineAgentDetail = AgentDetail
export type EngineAgentSetup = AgentSetup
export type EngineAgentKeysList = AgentKeysList
export type BoxConnection = ConnectionSummary
export type BoxConnectionUsage = ConnectionUsage
export type BoxDefault = BoxDefaultModel
export type BoxConnectionsList = ConnectionsList
export type CreateBoxConnectionInput = CreateConnectionInput
export type UpdateBoxConnectionInput = UpdateConnectionInput
export type EngineSession = Session
export type { SessionSource }
export type EngineMessage = Message
export type EngineMemory = Memory
export type EngineFileEntry = FileEntry
export type EngineFileContent = FileContent
export type EngineSkill = Skill & { enabled?: boolean }
export type EngineSkillWithSource = EngineSkill & { fromConnector: boolean }
export type EngineSkillSummary = Omit<z.infer<typeof engineSkillSummarySchema>, 'enabled'> & { enabled?: boolean }
export type EngineSkillFilePayload = SkillFilePayload
export type EngineSkillProposal = SkillProposal
export type EngineProvider = Provider
export type EngineVerbosity = Verbosity
export type EngineSchedule = Schedule
export type EngineTrigger = Trigger
export type EngineTriggerMethod = TriggerMethod
export type EngineRun = Run
export type EngineRunDetail = RunDetail
export type EngineRunResult = RunResult
export type EngineRunStep = RunStep
export type EngineRunStepsList = RunStepsList
export type EngineToolCall = ToolCall
export type EngineToolCallsList = ToolCallsList

export const engineUploadResultSchema = z.object({ path: z.string(), bytes: z.number() })
export type EngineUploadResult = z.infer<typeof engineUploadResultSchema>

export const engineLastUpdateSchema = z.object({
    status: z.enum(['running', 'error', 'restarting', 'success']),
    commit: z.string().nullable(),
    error: z.string().optional(),
    at: z.string(),
})
export type EngineLastUpdate = z.infer<typeof engineLastUpdateSchema>

export const engineHealthSchema = z.object({
    status: z.string(),
    activeAgents: z.number(),
    activeRuns: z.number().optional(),
    capabilities: z.array(z.string()).default([]),
    commit: z.string().nullable().optional(),
    startedAt: z.string().nullable().optional(),
    layout: z.string().optional(),
    lastUpdate: engineLastUpdateSchema.nullable().optional(),
    dataVersion: z.number().optional(),
    dataVersionTarget: z.number().optional(),
})
export type EngineHealth = z.infer<typeof engineHealthSchema>

export const engineUpdateResultSchema = z.object({
    started: z.boolean(),
    reason: z.string().optional(),
    activeRuns: z.number().optional(),
    commit: z.string().nullable().optional(),
    lastUpdate: engineLastUpdateSchema.nullable().optional(),
})
export type EngineUpdateResult = z.infer<typeof engineUpdateResultSchema>

export {
    engineDbColumnSchema,
    engineDbTableSchema,
    engineDbTablesListSchema,
    engineDbRowsSchema,
    engineDeleteRowsResultSchema,
    engineUsageBucketSchema,
    engineUsageSchema,
    dbQueryResultSchema,
    dbExecuteResultSchema,
} from '@moldwright/contracts'
export type { EngineDbColumn, EngineDbTable, EngineDbRows, EngineDeleteRowsResult, EngineUsageBucket, DbQueryInput, DbQueryResult, DbExecuteInput, DbExecuteResult } from '@moldwright/contracts'

export { statsPointSchema as engineStatsPointSchema, statsResponseSchema as engineStatsResponseSchema } from '@moldwright/contracts'
export { engineDoctorSchema } from '@moldwright/contracts'
export type { EngineDoctor, EngineDoctorCheck } from '@moldwright/contracts'
export type { StatsPoint as EngineStatsPoint, StatsQuery as EngineStatsQuery } from '@moldwright/contracts'

export type CronOutputEntry = {
    timestamp: string
    run_time: string
    size_bytes: number
}

export type SkillInfo = {
    id: string
    description: string
    category: string
    platforms?: string[]
    tags?: string[]
    enabled: boolean
}

export type ToolsetInfo = {
    id: string
    enabled: boolean
    heavy: boolean
}

export type ApprovalChoice = 'once' | 'session' | 'always' | 'deny'

export const notificationKindSchema = z.preprocess(value => (value === 'alert' ? 'info' : value), z.enum(['info', 'question', 'approval', 'connector', 'done', 'error']))
export type NotificationKind = z.infer<typeof notificationKindSchema>

export const RETIRED_NOTIFICATION_KIND = 'progress'
const wireNotificationKindSchema = z.union([notificationKindSchema, z.literal(RETIRED_NOTIFICATION_KIND)])

export const notificationPayloadSchema = z.object({
    event: z.enum(['agent.notification', 'agent.message.completed', 'agent.schedule.completed', 'agent.trigger.completed', 'agent.session.created']),
    kind: wireNotificationKindSchema,
    agentId: z.string().min(1),
    sessionId: z.string().nullable().optional(),
    runId: z.string().nullable().optional(),
    message: z.string().min(1).max(16_000),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
    title: z.string().max(200).nullable().optional(),
    source: z.enum(['dashboard', 'builder', 'schedule', 'agent', 'delegate', 'api', 'trigger']).nullable().optional(),
    originAgentId: z.string().nullable().optional(),
    timestamp: z.string(),
})
export type NotificationPayload = z.infer<typeof notificationPayloadSchema>

export const GETTING_STARTED_EVENT_STEP: Partial<Record<EngineCreatedEvent['event'], GettingStartedItem>> = { 'agent.schedule.created': 'schedule', 'box.connection.connected': 'ai_provider' }
export const engineCreatedEventSchema = z.object({
    event: z.enum(['agent.schedule.created', 'agent.trigger.created', 'box.connection.connected']),
    agentId: z.string().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
})
export type EngineCreatedEvent = z.infer<typeof engineCreatedEventSchema>
