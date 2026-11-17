import { createServer } from 'node:http'

// A model that speaks the OpenAI chat format (what a `custom` connection calls) and answers from a
// script instead of a network: each request hands the script the conversation and the tools, and the
// script says what to write and which tools to call. It costs nothing and always does the same thing,
// for the tests of the engine and the walks of `pnpm verify:*`. Plain JS so a scenario loads it as is.
//
//   const model = await startScriptedModel(({ messages }) => ({ text: 'Hi', toolCalls: [{ name: 'remote_exec', arguments: { … } }] }))
//   POST /connections { provider: 'custom', baseUrl: model.url, models: ['scripted'] }

const textOf = message => {
    if (typeof message?.content === 'string') return message.content
    if (Array.isArray(message?.content)) return message.content.map(part => part?.text ?? '').join('')
    return ''
}

function chunk(model, delta, finishReason = null, usage = undefined) {
    return `data: ${JSON.stringify({ id: 'chatcmpl-scripted', object: 'chat.completion.chunk', created: 0, model, choices: [{ index: 0, delta, finish_reason: finishReason }], ...(usage ? { usage } : {}) })}\n\n`
}

const USAGE = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }

export async function startScriptedModel(script) {
    const calls = []
    const server = createServer((req, res) => {
        let raw = ''
        req.on('data', part => (raw += part))
        req.on('end', async () => {
            if (req.method === 'GET' && req.url?.endsWith('/models')) {
                res.writeHead(200, { 'content-type': 'application/json' })
                return res.end(JSON.stringify({ object: 'list', data: [{ id: 'scripted', object: 'model' }] }))
            }
            let body = {}
            try {
                body = JSON.parse(raw || '{}')
            } catch {
                res.writeHead(400)
                return res.end()
            }
            const messages = body.messages ?? []
            const tools = (body.tools ?? []).map(tool => tool.function?.name).filter(Boolean)
            calls.push({ messages, tools })
            const answer = (await script({ messages, tools, last: messages.at(-1), lastText: textOf(messages.at(-1)) })) ?? {}
            const toolCalls = (answer.toolCalls ?? []).map((call, index) => ({ index, id: `call_${calls.length}_${index}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) } }))
            const model = body.model ?? 'scripted'
            if (!body.stream) {
                res.writeHead(200, { 'content-type': 'application/json' })
                return res.end(
                    JSON.stringify({
                        id: 'chatcmpl-scripted',
                        object: 'chat.completion',
                        created: 0,
                        model,
                        choices: [{ index: 0, message: { role: 'assistant', content: answer.text ?? '', ...(toolCalls.length ? { tool_calls: toolCalls.map(({ index: _index, ...call }) => call) } : {}) }, finish_reason: toolCalls.length ? 'tool_calls' : 'stop' }],
                        usage: USAGE,
                    }),
                )
            }
            res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
            res.write(chunk(model, { role: 'assistant', content: '' }))
            if (answer.text) res.write(chunk(model, { content: answer.text }))
            for (const call of toolCalls) res.write(chunk(model, { tool_calls: [call] }))
            res.write(chunk(model, {}, toolCalls.length ? 'tool_calls' : 'stop', USAGE))
            res.write('data: [DONE]\n\n')
            res.end()
        })
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address()
    return {
        url: `http://127.0.0.1:${port}/v1`,
        calls,
        close: () =>
            new Promise(resolve => {
                server.closeAllConnections()
                server.close(() => resolve())
            }),
    }
}

// The walk of a coworker asked to run one command on a linked computer: it tries, is told it needs
// the person's yes, asks with the card, runs it once approved, and reports what came back.
export function computerCommandScript({ computer, command, reason = 'To do what you asked' }) {
    return ({ tools, last, lastText }) => {
        // A call without the tools (a title, a summary) is not the coworker's turn.
        if (!tools.includes('remote_exec')) return { text: 'Work on the computer' }
        if (last?.role === 'tool') {
            if (lastText.includes('needs_approval')) return { text: `I need your yes before running this on #${computer}.`, toolCalls: [{ name: 'request_computer_access', arguments: { computer: `#${computer}`, reason, commands: [command] } }] }
            if (lastText.includes('"delivered"')) return { text: '' }
            return { text: `Here is what #${computer} answered:\n\n${lastText}` }
        }
        return { toolCalls: [{ name: 'remote_exec', arguments: { computer: `#${computer}`, command } }] }
    }
}
