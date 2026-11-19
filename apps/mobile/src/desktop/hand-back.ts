import type { TakeoverResult } from '@moldwright/contracts'

const waiting = new Map<string, (result: TakeoverResult) => void>()

export function awaitHandBack(callId: string): Promise<TakeoverResult> {
    return new Promise(resolve => waiting.set(callId, resolve))
}

export function handBack(callId: string, result: TakeoverResult) {
    waiting.get(callId)?.(result)
    waiting.delete(callId)
}
