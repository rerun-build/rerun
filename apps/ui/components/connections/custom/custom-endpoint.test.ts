import { describe, expect, it } from 'vitest'
import { connectionSummarySchema } from '@rerun/contracts'
import { ENGLISH_MESSAGES } from '@rerun/i18n/messages/en'
import { createTranslator } from 'use-intl'
import { isModelEnabled, offeredModels } from '@/lib/engine/ai-sources'
import { isHttpUrl, presetsFor, probeProblemMessage } from './custom-endpoint'

const t = createTranslator({ locale: 'en', messages: ENGLISH_MESSAGES, namespace: 'connections' })

const result = (problem: Parameters<typeof probeProblemMessage>[1]['problem'], detail: string | null = null) => ({ baseUrl: 'http://localhost:11434/v1', models: [], problem, detail })

describe('presetsFor', () => {
    it('keeps the servers that listen on the owner machine off Rerun Cloud', () => {
        expect(presetsFor(true).map(preset => preset.id)).toEqual(['groq', 'together', 'mistral', 'deepseek'])
        expect(presetsFor(false).map(preset => preset.id)).toEqual(['ollama', 'lmstudio', 'vllm', 'litellm', 'groq', 'together', 'mistral', 'deepseek'])
    })
})

describe('probeProblemMessage', () => {
    it('names the host that did not answer, and what it has to be on each edition', () => {
        expect(probeProblemMessage(t, result('unreachable'), undefined, false)).toBe('Could not reach localhost:11434. Check the server is running and reachable from the engine.')
        expect(probeProblemMessage(t, result('unreachable'), undefined, true)).toBe('Could not reach localhost:11434. It has to be a public address that answers.')
    })

    it('asks for a model id when the server lists none, and passes on why it refused one', () => {
        expect(probeProblemMessage(t, result('not_listed'), undefined, false)).toContain('Type the id')
        expect(probeProblemMessage(t, result('model_refused', '404 model "x" not found'), 'x', false)).toBe('The server refused x: 404 model "x" not found')
        expect(probeProblemMessage(t, result(null), undefined, false)).toBeNull()
    })
})

describe('isHttpUrl', () => {
    it('takes an http address and nothing else', () => {
        expect(isHttpUrl('http://localhost:11434/v1')).toBe(true)
        expect(isHttpUrl(' https://api.groq.com/openai/v1 ')).toBe(true)
        expect(isHttpUrl('localhost:11434')).toBe(false)
        expect(isHttpUrl('ftp://x')).toBe(false)
    })
})

describe('the models of a custom connection', () => {
    const connection = connectionSummarySchema.parse({
        id: 'cnx-custom',
        name: 'Ollama',
        provider: 'custom',
        baseUrl: 'http://localhost:11434/v1',
        models: ['qwen3:4b'],
        createdAt: '',
        connected: true,
        discoveredModels: [
            { id: 'qwen3:4b', contextWindow: null },
            { id: 'llama3.2:3b', contextWindow: null },
        ],
    })

    it('are what the endpoint listed, the ones switched off kept in the list', () => {
        expect(offeredModels(connection).map(model => [model.id, model.label, isModelEnabled(connection, model.id)])).toEqual([
            ['qwen3:4b', 'qwen3:4b', true],
            ['llama3.2:3b', 'llama3.2:3b', false],
        ])
    })
})
