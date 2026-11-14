import { Transform } from 'node:stream'
import { badRequest } from './errors.js'

export function capAt(maxBytes: number, message: (maxBytes: number) => string): Transform {
    let seen = 0
    return new Transform({
        transform(chunk: Buffer, _encoding, callback) {
            seen += chunk.byteLength
            if (seen > maxBytes) return callback(badRequest(message(maxBytes)))
            callback(null, chunk)
        },
    })
}
