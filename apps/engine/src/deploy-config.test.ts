import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import matter from 'gray-matter'
import { describe, expect, it } from 'vitest'

type Service = {
  image?: unknown
  build?: { dockerfile?: unknown } | string
  environment?: Record<string, unknown> | unknown[]
}

const root = fileURLToPath(new URL('../../../', import.meta.url))

function services(text: string): Record<string, Service> {
  const data = matter('---\n' + text + '\n---\n').data as { services?: Record<string, Service> }
  return data.services ?? {}
}

function engines(text: string): [string, Service][] {
  return Object.entries(services(text)).filter(([, service]) => {
    const image = typeof service.image === 'string' && service.image.includes('moldwright-engine')
    const build = typeof service.build === 'object' && service.build?.dockerfile === 'apps/engine/Dockerfile'
    return image || build
  })
}

function keyed(service: Service): boolean {
  const env = service.environment
  if (Array.isArray(env)) {
    return env.some((entry) => typeof entry === 'string' && entry.split('=')[0] === 'RERUN_API_KEY')
  }
  return typeof env === 'object' && env !== null && 'RERUN_API_KEY' in env
}

function offenders(text: string): string[] {
  return engines(text)
    .filter(([, service]) => keyed(service))
    .map(([name]) => name)
}

function read(path: string): string {
  return readFileSync(root + path, 'utf8')
}

describe('deploy config', () => {
  it('docker-compose.yml: the engine service lists no RERUN_API_KEY under environment', () => {
    const text = read('docker-compose.yml')
    expect(engines(text).map(([name]) => name)).toEqual(['engine'])
    expect(offenders(text)).toEqual([])
  })

  it('deploy/vps/dev-engine.yml: the engine service lists no RERUN_API_KEY under environment', () => {
    const text = read('deploy/vps/dev-engine.yml')
    expect(engines(text).map(([name]) => name)).toEqual(['engine-dev'])
    expect(offenders(text)).toEqual([])
  })

  it('flags an engine service that lists RERUN_API_KEY under environment, as a map or a list', () => {
    const a = 'services:\n  e:\n    image: x/moldwright-engine:dev\n    environment:\n      RERUN_API_KEY: ${K}\n'
    const b = 'services:\n  e:\n    build:\n      dockerfile: apps/engine/Dockerfile\n    environment:\n      - RERUN_API_KEY=${K}\n'
    const c = 'services:\n  e:\n    image: x/moldwright-engine:dev\n    environment:\n      - RERUN_API_KEY\n'
    const d = 'services:\n  e:\n    image: x/moldwright-engine:dev\n    environment:\n      RERUN_API_KEY_FILE: /run/secrets/k\n'
    expect(offenders(a)).toEqual(['e'])
    expect(offenders(b)).toEqual(['e'])
    expect(offenders(c)).toEqual(['e'])
    expect(offenders(d)).toEqual([])
  })
})
