import { existsSync, readFileSync } from 'node:fs'
import { sharedEnvPath } from '../config/paths.js'
import { parseEnvFile, writeEnvFile } from '../lib/env-file.js'

const SECRET_NAME = /(TOKEN|KEY|SECRET|PASSWORD)/
const SECRET_MIN_LENGTH = 8

export function readSharedEnvSync(): Record<string, string> {
    return existsSync(sharedEnvPath()) ? parseEnvFile(readFileSync(sharedEnvPath(), 'utf8')) : {}
}

export async function writeSharedEnv(env: Record<string, string>): Promise<void> {
    await writeEnvFile(sharedEnvPath(), env)
}

export function secretValuesOf(env: Record<string, string>): string[] {
    return Object.entries(env)
        .filter(([name, value]) => SECRET_NAME.test(name) && value.length >= SECRET_MIN_LENGTH)
        .map(([, value]) => value)
}
