import { describe, expect, it } from 'vitest'

import { externalizeArgs, externalizePairs, externalizeUrl, isSecretLike } from './mcp-secrets'

const DISCORD_TOKEN = 'MTAyNDkxODM3MjM4NDkxNzI4.GxKp9d.7fQm2LvXeR4tYuIoP1aSdF3gHjKlZxCvBnM'
const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
const UUID = '9f8c1b2e-5d47-4a3f-9c10-7e2b6a4d8f31'

describe('isSecretLike', () => {
    it('leaves the shapes an MCP command is made of alone', () => {
        for (const arg of [
            '-y',
            '--config',
            'github:Moldwright-build/mcp-discord#v1.4.1-rerun.1',
            '@modelcontextprotocol/server-filesystem',
            'mcp-remote@0.1.29',
            '/Users/someone/projects/notes',
            './scripts/start.sh',
            'https://mcp.notion.com/sse',
            'server-filesystem-readonly-v2',
        ]) {
            expect(isSecretLike(arg), arg).toBe(false)
        }
    })

    it('catches the token shapes', () => {
        for (const secret of [DISCORD_TOKEN, JWT, UUID, 'ghp_16C7e42F292c6912E7710c838347Ae178B4a', 'sk-proj-Yh7Kd', 'd41d8cd98f00b204e9800998ecf8427e', 'xoxb-2401-3948-aBcDeFgHiJkLmNoP']) {
            expect(isSecretLike(secret), secret).toBe(true)
        }
    })

    it('never touches a value that already carries a reference', () => {
        expect(isSecretLike('${RERUN_SVC_DISCORD_DISCORD_TOKEN}')).toBe(false)
    })
})

describe('externalizeArgs', () => {
    it('names the variable after the flag that precedes the secret', () => {
        const { value, keys } = externalizeArgs(['-y', 'github:Moldwright-build/mcp-discord#v1.4.1-rerun.1', '--config', DISCORD_TOKEN], 'discord')
        expect(value).toEqual(['-y', 'github:Moldwright-build/mcp-discord#v1.4.1-rerun.1', '--config', '${MCP_DISCORD_CONFIG}'])
        expect(keys).toEqual({ MCP_DISCORD_CONFIG: DISCORD_TOKEN })
    })

    it('splits the inline --flag=secret form', () => {
        const { value, keys } = externalizeArgs(['--api-key=' + JWT], 'linear')
        expect(value).toEqual(['--api-key=${MCP_LINEAR_API_KEY}'])
        expect(keys).toEqual({ MCP_LINEAR_API_KEY: JWT })
    })

    it('falls back to the position when no flag precedes it', () => {
        const { value, keys } = externalizeArgs(['serve', DISCORD_TOKEN], 'bot')
        expect(value[1]).toBe('${MCP_BOT_ARG1}')
        expect(keys.MCP_BOT_ARG1).toBe(DISCORD_TOKEN)
    })

    it('suffixes a colliding name', () => {
        const { value, keys } = externalizeArgs(['--token', DISCORD_TOKEN, '--token', JWT], 'dup')
        expect(value[1]).toBe('${MCP_DUP_TOKEN}')
        expect(value[3]).toBe('${MCP_DUP_TOKEN_2}')
        expect(Object.keys(keys)).toEqual(['MCP_DUP_TOKEN', 'MCP_DUP_TOKEN_2'])
    })

    it('reaches into an argument that is a URL', () => {
        const { value, keys } = externalizeArgs(['--endpoint', `https://mcp.pipedream.net/${UUID}/slack`], 'pipedream')
        expect(value[1]).toBe('https://mcp.pipedream.net/${MCP_PIPEDREAM_PATH1}/slack')
        expect(keys.MCP_PIPEDREAM_PATH1).toBe(UUID)
    })

    it('is idempotent: a second save creates no new key', () => {
        const first = externalizeArgs(['--config', DISCORD_TOKEN], 'discord')
        const second = externalizeArgs(first.value, 'discord')
        expect(second.value).toEqual(first.value)
        expect(second.keys).toEqual({})
    })
})

describe('externalizeUrl', () => {
    it('takes the userinfo password and nothing else', () => {
        const { value, keys } = externalizeUrl('https://admin:s3cret-p4ssw0rd@mcp.example.com/sse', 'example')
        expect(value).toBe('https://admin:${MCP_EXAMPLE_PASSWORD}@mcp.example.com/sse')
        expect(keys).toEqual({ MCP_EXAMPLE_PASSWORD: 's3cret-p4ssw0rd' })
    })

    it('takes a sensitive query value even when it is short', () => {
        const { value, keys } = externalizeUrl('https://mcp.example.com/sse?workspace=acme&token=abc123', 'example')
        expect(value).toBe('https://mcp.example.com/sse?workspace=acme&token=${MCP_EXAMPLE_TOKEN}')
        expect(keys).toEqual({ MCP_EXAMPLE_TOKEN: 'abc123' })
    })

    it('takes a secret path segment and leaves the rest byte-identical', () => {
        const { value, keys } = externalizeUrl(`https://mcp.composio.dev/${UUID}/mcp?include_composio_helper_actions=true`, 'composio')
        expect(value).toBe('https://mcp.composio.dev/${MCP_COMPOSIO_PATH1}/mcp?include_composio_helper_actions=true')
        expect(keys.MCP_COMPOSIO_PATH1).toBe(UUID)
    })

    it('leaves an ordinary URL untouched', () => {
        const url = 'https://mcp.notion.com/sse'
        expect(externalizeUrl(url, 'notion')).toEqual({ value: url, keys: {} })
    })

    it('is idempotent', () => {
        const first = externalizeUrl(`https://mcp.example.com/${UUID}/sse?token=${DISCORD_TOKEN}`, 'example')
        const second = externalizeUrl(first.value, 'example')
        expect(second.value).toBe(first.value)
        expect(second.keys).toEqual({})
    })
})

describe('externalizePairs', () => {
    it('sends every value to the key store, secret-looking or not', () => {
        expect(externalizePairs({ DISCORD_TOKEN: 'plain', DEBUG: '1' })).toEqual({
            value: { DISCORD_TOKEN: '${DISCORD_TOKEN}', DEBUG: '${DEBUG}' },
            keys: { DISCORD_TOKEN: 'plain', DEBUG: '1' },
        })
    })

    it('prefixes header names and keeps an existing reference whole', () => {
        expect(externalizePairs({ Authorization: 'Bearer ${MCP_X_AUTHORIZATION}', 'x-key': 'raw' }, 'MCP_X_')).toEqual({
            value: { Authorization: 'Bearer ${MCP_X_AUTHORIZATION}', 'x-key': '${MCP_X_X_KEY}' },
            keys: { MCP_X_X_KEY: 'raw' },
        })
    })
})
