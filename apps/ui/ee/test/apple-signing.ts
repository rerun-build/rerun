import { X509Certificate, createPrivateKey, createSign } from 'node:crypto'
import type { AppleVerifierOptions } from '@/ee/lib/billing/apple/verify'

// A certificate chain shaped like Apple's (a root, an intermediate carrying Apple's intermediate
// marker 1.2.840.113635.100.6.2.1, a leaf carrying the App Store signing marker
// 1.2.840.113635.100.6.11.1), minted with openssl for the tests and valid for a century. It signs
// transactions and notifications the real SignedDataVerifier accepts once handed this root, so the
// tests run Apple's own verification code instead of a mock of it. Test material only: nothing
// outside the tests trusts this root.

const ROOT_PEM = `-----BEGIN CERTIFICATE-----
MIIBpjCCAUygAwIBAgIUdYbrUHZWtyUrJzmMB+i5I04hn8gwCgYIKoZIzj0EAwIw
MDEYMBYGA1UEAwwPUmVydW4gVGVzdCBSb290MRQwEgYDVQQKDAtSZXJ1biB0ZXN0
czAgFw0yNjExMTIwOTI4MDNaGA8yMTI2MTAxOTA5MjgwM1owMDEYMBYGA1UEAwwP
UmVydW4gVGVzdCBSb290MRQwEgYDVQQKDAtSZXJ1biB0ZXN0czBZMBMGByqGSM49
AgEGCCqGSM49AwEHA0IABCJpMxaW6m9TsiKuTbpTDwbnmX+//OVdNV/WMjtIekU5
KkvqHoF3jgvv9BTzDbuIW2xyMONwp5E0yWsTD7YWpk+jQjBAMA8GA1UdEwEB/wQF
MAMBAf8wDgYDVR0PAQH/BAQDAgEGMB0GA1UdDgQWBBS3pPf6GQihKgfCTYCTQvaQ
DjxPqzAKBggqhkjOPQQDAgNIADBFAiA1fFWSBZIvZHPeO9Er8lG//rPnCxZqwIQx
n6QQWflzvQIhAIdSk+8pv2fsGDGUZhKrMaL1CZMleSryhcWVegp9S1AM
-----END CERTIFICATE-----`

const INTERMEDIATE_PEM = `-----BEGIN CERTIFICATE-----
MIIB5DCCAYqgAwIBAgIUY70hs30M+vMrN+dk8jU93Q6GGeowCgYIKoZIzj0EAwIw
MDEYMBYGA1UEAwwPUmVydW4gVGVzdCBSb290MRQwEgYDVQQKDAtSZXJ1biB0ZXN0
czAgFw0yNjExMTIwOTI4MDNaGA8yMTI2MTAxOTA5MjgwM1owODEgMB4GA1UEAwwX
UmVydW4gVGVzdCBJbnRlcm1lZGlhdGUxFDASBgNVBAoMC1JlcnVuIHRlc3RzMFkw
EwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEgKa003BbmRaonv669cdVH4FRgoS0y/tv
g4GfGVaR6yRsTcjEON7rWWmY1o05JOzZssf6h4ltCvvSbCMdEQkdwKN4MHYwEgYD
VR0TAQH/BAgwBgEB/wIBADAOBgNVHQ8BAf8EBAMCAQYwHQYDVR0OBBYEFLanES6E
hmnYnLMDaVb08LtKPTVhMB8GA1UdIwQYMBaAFLek9/oZCKEqB8JNgJNC9pAOPE+r
MBAGCiqGSIb3Y2QGAgEEAgUAMAoGCCqGSM49BAMCA0gAMEUCIHtwtyobI7W6Otwt
pAanTWpwEX8bIoj+a+X9e2FjihJdAiEAl1aXx+6O7uf6QsgLOgxfqvz++v3q4o0f
RbsNx3pbL/I=
-----END CERTIFICATE-----`

const LEAF_PEM = `-----BEGIN CERTIFICATE-----
MIIB3jCCAYSgAwIBAgIUcJaJCeb/i8dgzXhW9e9zqNa135cwCgYIKoZIzj0EAwIw
ODEgMB4GA1UEAwwXUmVydW4gVGVzdCBJbnRlcm1lZGlhdGUxFDASBgNVBAoMC1Jl
cnVuIHRlc3RzMCAXDTI2MTExMjA5MjgwM1oYDzIxMjYxMDE5MDkyODAzWjAwMRgw
FgYDVQQDDA9SZXJ1biBUZXN0IExlYWYxFDASBgNVBAoMC1JlcnVuIHRlc3RzMFkw
EwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEHheLXKqO/uTugokz9U89ovQqRagPi2zQ
bxYchhNfkxvS07OdTDSgdGx1jYSC2LpJrPo4ccK9ciRB7Ow1OQPz36NyMHAwDAYD
VR0TAQH/BAIwADAOBgNVHQ8BAf8EBAMCB4AwHQYDVR0OBBYEFMeoMt3uUvmDsDSa
KYtcv/wq1wtbMB8GA1UdIwQYMBaAFLanES6EhmnYnLMDaVb08LtKPTVhMBAGCiqG
SIb3Y2QGCwEEAgUAMAoGCCqGSM49BAMCA0gAMEUCIQCelbSxRBJo4BW63Stzn+Vf
3voTfmP45OTT29hMjxpRiAIgHhL248ljfRAeoGfSXUePRWsxe1utzSD9+GZxXkwI
DQA=
-----END CERTIFICATE-----`

const LEAF_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgwVhTbyI5+W4UFy1S
YLT927NdUbkEuCENuexgywl59TShRANCAAQeF4tcqo7+5O6CiTP1Tz2i9CpFqA+L
bNBvFhyGE1+TG9LTs51MNKB0bHWNhILYukms+jhxwr1yJEHs7DU5A/Pf
-----END PRIVATE KEY-----`

const der = (certificate: string) => new X509Certificate(certificate).raw

export const TEST_APPLE_VERIFIER_OPTIONS: AppleVerifierOptions = { roots: [der(ROOT_PEM)], onlineChecks: false }

// Signs a payload the way the App Store does: ES256, the chain in the `x5c` header.
export function signAppleJws(payload: object, { chain = [LEAF_PEM, INTERMEDIATE_PEM, ROOT_PEM], key = LEAF_KEY_PEM }: { chain?: string[]; key?: string } = {}): string {
    const header = { alg: 'ES256', x5c: chain.map(certificate => der(certificate).toString('base64')) }
    const input = `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`
    const signature = createSign('SHA256').update(input).sign({ key: createPrivateKey(key), dsaEncoding: 'ieee-p1363' })
    return `${input}.${signature.toString('base64url')}`
}

// The same payload, unsigned by Apple: what Xcode's local StoreKit testing hands an app.
export function unsignedXcodeJws(payload: object): string {
    return `${Buffer.from(JSON.stringify({ alg: 'ES256', kid: 'Apple_Xcode_Key' })).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.c2lnbmF0dXJl`
}
