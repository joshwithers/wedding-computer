/**
 * WebAuthn passkey service for Cloudflare Workers.
 *
 * Uses the Web Crypto API exclusively (no external dependencies).
 * Challenges are stored in KV with the same pattern as magic links.
 * Credential records are managed via src/db/passkeys.ts.
 */

import {
  listPasskeys,
  getPasskeyByCredentialId,
  createPasskey,
  updatePasskeyCounter,
  getCredentialIdsForUser,
} from '../db/passkeys'
import { getUserByEmail } from '../db/users'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RP_NAME = 'Wedding Computer'
const CHALLENGE_TTL = 300 // 5 minutes

// ---------------------------------------------------------------------------
// Base64url helpers
// ---------------------------------------------------------------------------

export function base64urlEncode(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export function base64urlDecode(str: string): Uint8Array {
  str = str.replace(/-/g, '+').replace(/_/g, '/')
  while (str.length % 4) str += '='
  const binary = atob(str)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

// ---------------------------------------------------------------------------
// Relying Party ID
// ---------------------------------------------------------------------------

export function getRpId(appUrl: string): string {
  try {
    const url = new URL(appUrl)
    return url.hostname
  } catch {
    return 'localhost'
  }
}

function getExpectedOrigins(appUrl: string): string[] {
  try {
    const url = new URL(appUrl)
    // In development localhost may use http
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
      return [
        `http://${url.host}`,
        `https://${url.host}`,
      ]
    }
    return [url.origin]
  } catch {
    return ['http://localhost:8787']
  }
}

// ---------------------------------------------------------------------------
// Minimal CBOR decoder (sufficient for WebAuthn attestation objects)
// ---------------------------------------------------------------------------

interface CborState {
  data: Uint8Array
  offset: number
}

function cborReadUint(state: CborState, additionalInfo: number): number {
  if (additionalInfo < 24) return additionalInfo
  if (additionalInfo === 24) {
    const val = state.data[state.offset]
    state.offset += 1
    return val
  }
  if (additionalInfo === 25) {
    const val = (state.data[state.offset] << 8) | state.data[state.offset + 1]
    state.offset += 2
    return val
  }
  if (additionalInfo === 26) {
    const val =
      (state.data[state.offset] << 24) |
      (state.data[state.offset + 1] << 16) |
      (state.data[state.offset + 2] << 8) |
      state.data[state.offset + 3]
    state.offset += 4
    return val >>> 0 // unsigned
  }
  throw new Error(`CBOR: unsupported additional info ${additionalInfo}`)
}

function cborDecode(state: CborState): unknown {
  if (state.offset >= state.data.length) {
    throw new Error('CBOR: unexpected end of data')
  }

  const initial = state.data[state.offset]
  state.offset += 1

  const majorType = initial >> 5
  const additionalInfo = initial & 0x1f

  switch (majorType) {
    // Major type 0: unsigned integer
    case 0:
      return cborReadUint(state, additionalInfo)

    // Major type 1: negative integer
    case 1:
      return -1 - cborReadUint(state, additionalInfo)

    // Major type 2: byte string
    case 2: {
      const len = cborReadUint(state, additionalInfo)
      const bytes = state.data.slice(state.offset, state.offset + len)
      state.offset += len
      return bytes
    }

    // Major type 3: text string
    case 3: {
      const len = cborReadUint(state, additionalInfo)
      const bytes = state.data.slice(state.offset, state.offset + len)
      state.offset += len
      return new TextDecoder().decode(bytes)
    }

    // Major type 4: array
    case 4: {
      const len = cborReadUint(state, additionalInfo)
      const arr: unknown[] = []
      for (let i = 0; i < len; i++) {
        arr.push(cborDecode(state))
      }
      return arr
    }

    // Major type 5: map
    case 5: {
      const len = cborReadUint(state, additionalInfo)
      const map = new Map<unknown, unknown>()
      for (let i = 0; i < len; i++) {
        const key = cborDecode(state)
        const value = cborDecode(state)
        map.set(key, value)
      }
      return map
    }

    // Major type 7: simple values / floats
    case 7: {
      if (additionalInfo === 20) return false
      if (additionalInfo === 21) return true
      if (additionalInfo === 22) return null
      throw new Error(`CBOR: unsupported simple value ${additionalInfo}`)
    }

    default:
      throw new Error(`CBOR: unsupported major type ${majorType}`)
  }
}

export function decodeCbor(data: Uint8Array): unknown {
  const state: CborState = { data, offset: 0 }
  return cborDecode(state)
}

// ---------------------------------------------------------------------------
// DER signature to raw r||s conversion
// ---------------------------------------------------------------------------

export function derToRaw(derSig: Uint8Array): Uint8Array {
  // DER format: 30 <total-len> 02 <r-len> <r> 02 <s-len> <s>
  if (derSig[0] !== 0x30) {
    throw new Error('WebAuthn: invalid DER signature — missing SEQUENCE tag')
  }

  const raw = new Uint8Array(64)
  let offset = 2 // skip SEQUENCE tag and length

  // Read r
  if (derSig[offset] !== 0x02) {
    throw new Error('WebAuthn: invalid DER signature — missing INTEGER tag for r')
  }
  offset += 1
  const rLen = derSig[offset]
  offset += 1

  // r may have a leading zero byte for sign padding — skip it
  if (rLen === 33 && derSig[offset] === 0x00) {
    raw.set(derSig.slice(offset + 1, offset + 33), 0)
  } else if (rLen === 32) {
    raw.set(derSig.slice(offset, offset + 32), 0)
  } else if (rLen < 32) {
    // r is shorter than 32 bytes — pad with leading zeros
    raw.set(derSig.slice(offset, offset + rLen), 32 - rLen)
  } else {
    throw new Error(`WebAuthn: unexpected r length in DER signature: ${rLen}`)
  }
  offset += rLen

  // Read s
  if (derSig[offset] !== 0x02) {
    throw new Error('WebAuthn: invalid DER signature — missing INTEGER tag for s')
  }
  offset += 1
  const sLen = derSig[offset]
  offset += 1

  if (sLen === 33 && derSig[offset] === 0x00) {
    raw.set(derSig.slice(offset + 1, offset + 33), 32)
  } else if (sLen === 32) {
    raw.set(derSig.slice(offset, offset + 32), 32)
  } else if (sLen < 32) {
    raw.set(derSig.slice(offset, offset + sLen), 64 - sLen)
  } else {
    throw new Error(`WebAuthn: unexpected s length in DER signature: ${sLen}`)
  }

  return raw
}

// ---------------------------------------------------------------------------
// Authenticator data parsing
// ---------------------------------------------------------------------------

interface AuthenticatorData {
  rpIdHash: Uint8Array
  flags: number
  signCount: number
  attestedCredentialData?: {
    aaguid: Uint8Array
    credentialId: Uint8Array
    publicKey: Uint8Array // uncompressed EC point (65 bytes: 04 || x || y)
  }
}

function parseAuthenticatorData(data: Uint8Array): AuthenticatorData {
  if (data.length < 37) {
    throw new Error('WebAuthn: authenticator data too short')
  }

  const rpIdHash = data.slice(0, 32)
  const flags = data[32]
  const signCount =
    (data[33] << 24) | (data[34] << 16) | (data[35] << 8) | data[36]

  const result: AuthenticatorData = { rpIdHash, flags, signCount }

  // Bit 6 (0x40): attested credential data present
  if (flags & 0x40) {
    if (data.length < 55) {
      throw new Error('WebAuthn: authenticator data too short for attested credential data')
    }

    const aaguid = data.slice(37, 53)
    const credentialIdLength = (data[53] << 8) | data[54]

    if (data.length < 55 + credentialIdLength) {
      throw new Error('WebAuthn: authenticator data too short for credential ID')
    }

    const credentialId = data.slice(55, 55 + credentialIdLength)

    // The rest is a CBOR-encoded COSE public key
    const coseKeyBytes = data.slice(55 + credentialIdLength)
    const coseKey = decodeCbor(coseKeyBytes)

    if (!(coseKey instanceof Map)) {
      throw new Error('WebAuthn: COSE key is not a CBOR map')
    }

    // COSE key labels:
    //  1 = key type (2 = EC2)
    //  3 = algorithm (-7 = ES256)
    // -1 = curve (1 = P-256)
    // -2 = x coordinate (32 bytes)
    // -3 = y coordinate (32 bytes)
    const kty = coseKey.get(1)
    if (kty !== 2) {
      throw new Error(`WebAuthn: unsupported COSE key type ${kty} (only EC2 supported)`)
    }

    const alg = coseKey.get(3)
    if (alg !== -7) {
      throw new Error(`WebAuthn: unsupported COSE algorithm ${alg} (only ES256 / -7 supported)`)
    }

    const x = coseKey.get(-2)
    const y = coseKey.get(-3)

    if (!(x instanceof Uint8Array) || x.length !== 32) {
      throw new Error('WebAuthn: invalid COSE key x coordinate')
    }
    if (!(y instanceof Uint8Array) || y.length !== 32) {
      throw new Error('WebAuthn: invalid COSE key y coordinate')
    }

    // Build uncompressed EC point: 0x04 || x || y
    const publicKey = new Uint8Array(65)
    publicKey[0] = 0x04
    publicKey.set(x, 1)
    publicKey.set(y, 33)

    result.attestedCredentialData = { aaguid, credentialId, publicKey }
  }

  return result
}

// ---------------------------------------------------------------------------
// Challenge helpers
// ---------------------------------------------------------------------------

async function generateChallenge(): Promise<Uint8Array> {
  const buf = new Uint8Array(32)
  crypto.getRandomValues(buf)
  return buf
}

async function storeChallenge(
  kv: KVNamespace,
  challenge: string,
  data: { userId?: string; type: 'registration' | 'authentication' }
): Promise<void> {
  await kv.put(
    `webauthn:challenge:${challenge}`,
    JSON.stringify(data),
    { expirationTtl: CHALLENGE_TTL }
  )
}

async function consumeChallenge(
  kv: KVNamespace,
  challenge: string
): Promise<{ userId?: string; type: string } | null> {
  const key = `webauthn:challenge:${challenge}`
  const data = await kv.get(key)
  if (!data) return null
  // Single-use: delete immediately
  await kv.delete(key)
  return JSON.parse(data) as { userId?: string; type: string }
}

// ---------------------------------------------------------------------------
// Client data verification
// ---------------------------------------------------------------------------

function verifyClientDataJSON(
  clientDataJSON: Uint8Array,
  expectedType: string,
  expectedChallenge: string,
  expectedOrigins: string[]
): { verified: boolean; error?: string } {
  let clientData: { type?: string; challenge?: string; origin?: string }
  try {
    clientData = JSON.parse(new TextDecoder().decode(clientDataJSON))
  } catch {
    return { verified: false, error: 'Failed to parse clientDataJSON' }
  }

  if (clientData.type !== expectedType) {
    return {
      verified: false,
      error: `clientDataJSON type mismatch: expected "${expectedType}", got "${clientData.type}"`,
    }
  }

  if (clientData.challenge !== expectedChallenge) {
    return { verified: false, error: 'Challenge mismatch' }
  }

  if (!expectedOrigins.includes(clientData.origin ?? '')) {
    return {
      verified: false,
      error: `Origin mismatch: expected one of [${expectedOrigins.join(', ')}], got "${clientData.origin}"`,
    }
  }

  return { verified: true }
}

// ---------------------------------------------------------------------------
// 1. Generate registration options
// ---------------------------------------------------------------------------

export async function generateRegistrationOptions(
  kv: KVNamespace,
  db: D1Database,
  user: { id: string; email: string; name: string },
  appUrl: string
): Promise<{
  challenge: string
  rp: { name: string; id: string }
  user: { id: string; name: string; displayName: string }
  pubKeyCredParams: { type: 'public-key'; alg: number }[]
  timeout: number
  attestation: string
  excludeCredentials: { id: string; type: 'public-key' }[]
  authenticatorSelection: {
    residentKey: string
    userVerification: string
  }
}> {
  const challenge = await generateChallenge()
  const challengeB64 = base64urlEncode(challenge)

  await storeChallenge(kv, challengeB64, {
    userId: user.id,
    type: 'registration',
  })

  // Exclude existing credentials to prevent re-registration
  const existingIds = await getCredentialIdsForUser(db, user.id)
  const excludeCredentials = existingIds.map((id) => ({
    id,
    type: 'public-key' as const,
  }))

  const rpId = getRpId(appUrl)

  return {
    challenge: challengeB64,
    rp: { name: RP_NAME, id: rpId },
    user: {
      id: base64urlEncode(new TextEncoder().encode(user.id)),
      name: user.email,
      displayName: user.name,
    },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },   // ES256 (ECDSA P-256)
      { type: 'public-key', alg: -257 },  // RS256 (RSASSA-PKCS1-v1_5) fallback
    ],
    timeout: 60000,
    attestation: 'none',
    excludeCredentials,
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  }
}

// ---------------------------------------------------------------------------
// 2. Verify registration response
// ---------------------------------------------------------------------------

export async function verifyRegistration(
  kv: KVNamespace,
  db: D1Database,
  userId: string,
  response: {
    id: string
    rawId: string
    type: string
    response: {
      clientDataJSON: string
      attestationObject: string
    }
    authenticatorAttachment?: string
  },
  appUrl: string,
  deviceName?: string
): Promise<{ verified: boolean; error?: string }> {
  if (response.type !== 'public-key') {
    return { verified: false, error: 'Response type must be "public-key"' }
  }

  // Decode clientDataJSON
  const clientDataBytes = base64urlDecode(response.response.clientDataJSON)
  let clientData: { type?: string; challenge?: string; origin?: string }
  try {
    clientData = JSON.parse(new TextDecoder().decode(clientDataBytes))
  } catch {
    return { verified: false, error: 'Failed to parse clientDataJSON' }
  }

  const challenge = clientData.challenge
  if (!challenge) {
    return { verified: false, error: 'Missing challenge in clientDataJSON' }
  }

  // Consume challenge from KV (single-use)
  const challengeData = await consumeChallenge(kv, challenge)
  if (!challengeData) {
    return { verified: false, error: 'Challenge not found or expired' }
  }
  if (challengeData.type !== 'registration') {
    return { verified: false, error: 'Challenge type mismatch — expected registration' }
  }
  if (challengeData.userId !== userId) {
    return { verified: false, error: 'Challenge was issued to a different user' }
  }

  // Verify clientDataJSON fields
  const expectedOrigins = getExpectedOrigins(appUrl)
  const cdVerify = verifyClientDataJSON(
    clientDataBytes,
    'webauthn.create',
    challenge,
    expectedOrigins
  )
  if (!cdVerify.verified) {
    return cdVerify
  }

  // Decode attestation object (CBOR)
  const attestationBytes = base64urlDecode(response.response.attestationObject)
  let attestationObj: Map<unknown, unknown>
  try {
    const decoded = decodeCbor(attestationBytes)
    if (!(decoded instanceof Map)) {
      return { verified: false, error: 'Attestation object is not a CBOR map' }
    }
    attestationObj = decoded
  } catch (e) {
    return {
      verified: false,
      error: `Failed to decode attestation object: ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  const authDataBytes = attestationObj.get('authData')
  if (!(authDataBytes instanceof Uint8Array)) {
    return { verified: false, error: 'Missing or invalid authData in attestation object' }
  }

  // Parse authenticator data
  let authData: AuthenticatorData
  try {
    authData = parseAuthenticatorData(authDataBytes)
  } catch (e) {
    return {
      verified: false,
      error: `Failed to parse authenticator data: ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  // Verify RP ID hash
  const rpId = getRpId(appUrl)
  const expectedRpIdHash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rpId))
  )
  if (!timingSafeEqual(authData.rpIdHash, expectedRpIdHash)) {
    return { verified: false, error: 'RP ID hash mismatch' }
  }

  // Verify flags: user present (bit 0) must be set
  if (!(authData.flags & 0x01)) {
    return { verified: false, error: 'User present flag not set' }
  }

  // Attested credential data must be present for registration
  if (!authData.attestedCredentialData) {
    return { verified: false, error: 'No attested credential data in registration response' }
  }

  const { credentialId, publicKey } = authData.attestedCredentialData
  const credentialIdB64 = base64urlEncode(credentialId)

  // Verify this credential ID matches the response
  if (credentialIdB64 !== response.id) {
    return { verified: false, error: 'Credential ID mismatch between authData and response' }
  }

  // Check for duplicate credential
  const existing = await getPasskeyByCredentialId(db, credentialIdB64)
  if (existing) {
    return { verified: false, error: 'Credential already registered' }
  }

  // Determine backup state from flags
  const backedUp = !!(authData.flags & 0x10)

  // Store the credential
  await createPasskey(db, {
    user_id: userId,
    credential_id: credentialIdB64,
    public_key: base64urlEncode(publicKey),
    counter: authData.signCount,
    device_name: deviceName,
    backed_up: backedUp,
  })

  return { verified: true }
}

// ---------------------------------------------------------------------------
// 3. Generate authentication options
// ---------------------------------------------------------------------------

export async function generateAuthenticationOptions(
  kv: KVNamespace,
  db: D1Database,
  appUrl: string,
  email?: string
): Promise<{
  challenge: string
  timeout: number
  rpId: string
  allowCredentials: { id: string; type: 'public-key'; transports?: string[] }[]
  userVerification: string
}> {
  const challenge = await generateChallenge()
  const challengeB64 = base64urlEncode(challenge)

  let userId: string | undefined
  let allowCredentials: { id: string; type: 'public-key'; transports?: string[] }[] = []

  if (email) {
    // Scope to this user's credentials if email is provided
    const user = await getUserByEmail(db, email)
    if (user) {
      userId = user.id
      const passkeys = await listPasskeys(db, user.id)
      allowCredentials = passkeys.map((p) => {
        const cred: { id: string; type: 'public-key'; transports?: string[] } = {
          id: p.credential_id,
          type: 'public-key',
        }
        if (p.transports) {
          try {
            cred.transports = JSON.parse(p.transports) as string[]
          } catch {
            // Ignore malformed transports
          }
        }
        return cred
      })
    }
  }

  await storeChallenge(kv, challengeB64, {
    userId,
    type: 'authentication',
  })

  return {
    challenge: challengeB64,
    timeout: 60000,
    rpId: getRpId(appUrl),
    allowCredentials,
    userVerification: 'preferred',
  }
}

// ---------------------------------------------------------------------------
// 4. Verify authentication response
// ---------------------------------------------------------------------------

export async function verifyAuthentication(
  kv: KVNamespace,
  db: D1Database,
  response: {
    id: string
    rawId: string
    type: string
    response: {
      clientDataJSON: string
      authenticatorData: string
      signature: string
      userHandle?: string
    }
  },
  appUrl: string
): Promise<{ verified: boolean; userId?: string; error?: string }> {
  if (response.type !== 'public-key') {
    return { verified: false, error: 'Response type must be "public-key"' }
  }

  // Look up the credential
  const credential = await getPasskeyByCredentialId(db, response.id)
  if (!credential) {
    return { verified: false, error: 'Credential not found' }
  }

  // Decode clientDataJSON
  const clientDataBytes = base64urlDecode(response.response.clientDataJSON)
  let clientData: { type?: string; challenge?: string; origin?: string }
  try {
    clientData = JSON.parse(new TextDecoder().decode(clientDataBytes))
  } catch {
    return { verified: false, error: 'Failed to parse clientDataJSON' }
  }

  const challenge = clientData.challenge
  if (!challenge) {
    return { verified: false, error: 'Missing challenge in clientDataJSON' }
  }

  // Consume challenge from KV (single-use)
  const challengeData = await consumeChallenge(kv, challenge)
  if (!challengeData) {
    return { verified: false, error: 'Challenge not found or expired' }
  }
  if (challengeData.type !== 'authentication') {
    return { verified: false, error: 'Challenge type mismatch — expected authentication' }
  }

  // If challenge was scoped to a user, verify it matches
  if (challengeData.userId && challengeData.userId !== credential.user_id) {
    return { verified: false, error: 'Credential does not belong to the expected user' }
  }

  // Verify clientDataJSON fields
  const expectedOrigins = getExpectedOrigins(appUrl)
  const cdVerify = verifyClientDataJSON(
    clientDataBytes,
    'webauthn.get',
    challenge,
    expectedOrigins
  )
  if (!cdVerify.verified) {
    return cdVerify
  }

  // Decode authenticator data
  const authDataBytes = base64urlDecode(response.response.authenticatorData)
  if (authDataBytes.length < 37) {
    return { verified: false, error: 'Authenticator data too short' }
  }

  // Verify RP ID hash
  const rpId = getRpId(appUrl)
  const rpIdHash = authDataBytes.slice(0, 32)
  const expectedRpIdHash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rpId))
  )
  if (!timingSafeEqual(rpIdHash, expectedRpIdHash)) {
    return { verified: false, error: 'RP ID hash mismatch' }
  }

  // Verify flags: user present (bit 0) must be set
  const flags = authDataBytes[32]
  if (!(flags & 0x01)) {
    return { verified: false, error: 'User present flag not set' }
  }

  // Verify the signature
  // Data to verify = authenticatorData || SHA-256(clientDataJSON)
  const clientDataHash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', clientDataBytes)
  )
  const signedData = new Uint8Array(authDataBytes.length + clientDataHash.length)
  signedData.set(authDataBytes, 0)
  signedData.set(clientDataHash, authDataBytes.length)

  // Import the stored public key
  const publicKeyBytes = base64urlDecode(credential.public_key)
  let key: CryptoKey
  try {
    key = await crypto.subtle.importKey(
      'raw',
      publicKeyBytes,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    )
  } catch (e) {
    return {
      verified: false,
      error: `Failed to import public key: ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  // Decode and convert the DER signature to raw r||s format
  const signatureBytes = base64urlDecode(response.response.signature)
  let rawSignature: Uint8Array
  try {
    rawSignature = derToRaw(signatureBytes)
  } catch (e) {
    return {
      verified: false,
      error: `Failed to decode signature: ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  // Verify the signature
  let valid: boolean
  try {
    valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      rawSignature,
      signedData
    )
  } catch (e) {
    return {
      verified: false,
      error: `Signature verification failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  if (!valid) {
    return { verified: false, error: 'Signature verification failed' }
  }

  // Replay protection: check sign counter
  const signCount =
    (authDataBytes[33] << 24) |
    (authDataBytes[34] << 16) |
    (authDataBytes[35] << 8) |
    authDataBytes[36]

  // Counter of 0 means the authenticator does not support counters — skip check.
  // Otherwise the new counter must be strictly greater than the stored one.
  if (signCount > 0 || credential.counter > 0) {
    if (signCount <= credential.counter) {
      return {
        verified: false,
        error: 'Sign counter did not increase — possible credential cloning detected',
      }
    }
  }

  // Update the counter in the database
  await updatePasskeyCounter(db, credential.credential_id, signCount)

  return { verified: true, userId: credential.user_id }
}

// ---------------------------------------------------------------------------
// Timing-safe comparison
// ---------------------------------------------------------------------------

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a[i] ^ b[i]
  }
  return mismatch === 0
}
