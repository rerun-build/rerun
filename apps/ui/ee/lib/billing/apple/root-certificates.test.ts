import { X509Certificate } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { appleRootCertificates } from './root-certificates'

// Published on https://www.apple.com/certificateauthority/ next to the certificate itself.
const APPLE_ROOT_CA_G3_SHA256 = '63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79'

describe('appleRootCertificates', () => {
    it('pins Apple Root CA - G3 by its published fingerprint', () => {
        const [root] = appleRootCertificates().map(der => new X509Certificate(der))
        expect(root?.fingerprint256).toBe(APPLE_ROOT_CA_G3_SHA256)
        expect(root?.subject).toContain('CN=Apple Root CA - G3')
        expect(root?.ca).toBe(true)
    })
})
