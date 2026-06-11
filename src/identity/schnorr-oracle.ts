// Grumpkin Schnorr oracle signer — the native counterpart of the v3 circuit's
// in-circuit verification (noir-lang/schnorr v0.4.0: Schnorr over Grumpkin
// with a Poseidon2 challenge).
//
// Scheme (must mirror schnorr/src/lib.nr exactly):
//   message = Poseidon2([wallet, github_id, github_created_year, commits, stars, events])
//   R = k·G                       (k random nonce in the Grumpkin scalar field)
//   e = Poseidon2([DST, R.x, pk.x, pk.y, message])
//   s = k − e·sk  (mod n)
//   signature = (s, e); the circuit recomputes R' = s·G + e·PK and checks the
//   challenge over R'.x matches e.
//
// Poseidon2 comes from bb.js (same C++ implementation Noir compiles against);
// curve arithmetic is plain bigint over Grumpkin (y² = x³ − 17 over the BN254
// scalar field). Implementation is validated against the schnorr library's
// pinned test vectors (`pinned_vector_small` / `pinned_vector_large`) in
// identity.service.spec.ts. Scalar mul is not constant-time — acceptable for a
// server-side oracle key, not for user-held keys.

import { BarretenbergSync } from '@aztec/bb.js';
import { randomBytes } from 'crypto';

/** Grumpkin base field (= BN254 scalar field): coordinates live here. */
const FIELD_MODULUS = BigInt(
  '0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001',
);
/** Grumpkin scalar field (= BN254 base field): scalars live here. */
export const GRUMPKIN_SCALAR_MODULUS = BigInt(
  '0x30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47',
);
/** Domain separation tag pinned in noir-lang/schnorr v0.4.0. */
export const SCHNORR_CHALLENGE_DST = BigInt(
  '0x024c76938ed06b8ec1d9094b1013d190baa4011372f0604643bda812a63b832e',
);
const TWO_POW_128 = BigInt(1) << BigInt(128);

const mod = (a: bigint, m: bigint): bigint => ((a % m) + m) % m;

function modInverse(a: bigint, m: bigint): bigint {
  let [g, x] = [m, BigInt(0)];
  let [r, s] = [mod(a, m), BigInt(1)];
  while (r) {
    const q = g / r;
    [g, r] = [r, g - q * r];
    [x, s] = [s, x - q * s];
  }
  if (g !== BigInt(1)) throw new Error('modular inverse does not exist');
  return mod(x, m);
}

export type GrumpkinPoint = { x: bigint; y: bigint; infinite?: boolean };

const POINT_AT_INFINITY: GrumpkinPoint = { x: BigInt(0), y: BigInt(0), infinite: true };

/** Grumpkin generator (matches Noir's `EmbeddedCurvePoint::generator()`). */
export const GRUMPKIN_GENERATOR: GrumpkinPoint = {
  x: BigInt(1),
  y: BigInt('0x0000000000000002cf135e7506a45d632d270d45f1181294833fc48d823f272c'),
};

function pointAdd(a: GrumpkinPoint, b: GrumpkinPoint): GrumpkinPoint {
  if (a.infinite) return b;
  if (b.infinite) return a;
  if (a.x === b.x) {
    if (mod(a.y + b.y, FIELD_MODULUS) === BigInt(0)) return POINT_AT_INFINITY;
    const lambda = mod(
      BigInt(3) * a.x * a.x * modInverse(BigInt(2) * a.y, FIELD_MODULUS),
      FIELD_MODULUS,
    );
    const x = mod(lambda * lambda - BigInt(2) * a.x, FIELD_MODULUS);
    return { x, y: mod(lambda * (a.x - x) - a.y, FIELD_MODULUS) };
  }
  const lambda = mod((b.y - a.y) * modInverse(b.x - a.x, FIELD_MODULUS), FIELD_MODULUS);
  const x = mod(lambda * lambda - a.x - b.x, FIELD_MODULUS);
  return { x, y: mod(lambda * (a.x - x) - a.y, FIELD_MODULUS) };
}

function pointMul(point: GrumpkinPoint, scalar: bigint): GrumpkinPoint {
  let result = POINT_AT_INFINITY;
  let addend = point;
  let k = mod(scalar, GRUMPKIN_SCALAR_MODULUS);
  while (k) {
    if (k & BigInt(1)) result = pointAdd(result, addend);
    addend = pointAdd(addend, addend);
    k >>= BigInt(1);
  }
  return result;
}

// ── Poseidon2 via bb.js ───────────────────────────────────────────────────────

const toFieldBuffer = (value: bigint): Buffer =>
  Buffer.from(value.toString(16).padStart(64, '0'), 'hex');

async function poseidon2Hash(fields: bigint[]): Promise<bigint> {
  const api = await BarretenbergSync.initSingleton();
  const { hash } = api.poseidon2Hash({ inputs: fields.map(toFieldBuffer) });
  return BigInt('0x' + Buffer.from(hash).toString('hex'));
}

// ── Public API ────────────────────────────────────────────────────────────────

export function parseSchnorrPrivateKey(hex: string): bigint {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]{1,64}$/.test(clean)) {
    throw new Error('ORACLE_SCHNORR_PRIVATE_KEY must be a hex scalar');
  }
  const value = mod(BigInt('0x' + clean), GRUMPKIN_SCALAR_MODULUS);
  if (value === BigInt(0)) throw new Error('ORACLE_SCHNORR_PRIVATE_KEY reduces to zero');
  return value;
}

export function randomSchnorrPrivateKey(): bigint {
  for (;;) {
    const candidate = mod(
      BigInt('0x' + randomBytes(32).toString('hex')),
      GRUMPKIN_SCALAR_MODULUS,
    );
    if (candidate !== BigInt(0)) return candidate;
  }
}

export function deriveSchnorrPublicKey(privateKey: bigint): GrumpkinPoint {
  return pointMul(GRUMPKIN_GENERATOR, privateKey);
}

/**
 * The Poseidon2 commitment the circuit recomputes in Step 1 of main.nr:
 *   Poseidon2([walletHi·2¹²⁸ + walletLo, githubId, createdYear, commits, stars, events])
 */
export async function computeIdentityCommitment(parts: {
  walletAddressHi: bigint;
  walletAddressLo: bigint;
  githubId: bigint;
  githubCreatedYear: bigint;
  commits: bigint;
  stars: bigint;
  events: bigint;
}): Promise<bigint> {
  const wallet = parts.walletAddressHi * TWO_POW_128 + parts.walletAddressLo;
  return poseidon2Hash([
    wallet,
    parts.githubId,
    parts.githubCreatedYear,
    parts.commits,
    parts.stars,
    parts.events,
  ]);
}

/**
 * Sign `message` (a BN254 field element) with the oracle key.
 * Returns the 64-byte `s ‖ e` signature as 0x-prefixed hex — the wire format
 * the frontend prover splits into the circuit's four 128-bit limbs.
 */
export async function signIdentityCommitment(
  privateKey: bigint,
  message: bigint,
): Promise<string> {
  const publicKey = deriveSchnorrPublicKey(privateKey);
  for (;;) {
    const nonce = randomSchnorrPrivateKey();
    const r = pointMul(GRUMPKIN_GENERATOR, nonce);
    const e = await poseidon2Hash([
      SCHNORR_CHALLENGE_DST,
      r.x,
      publicKey.x,
      publicKey.y,
      message,
    ]);
    const s = mod(nonce - e * privateKey, GRUMPKIN_SCALAR_MODULUS);
    // The circuit rejects zero scalars; retry with a fresh nonce (≈ never).
    if (s === BigInt(0) || e === BigInt(0)) continue;
    return (
      '0x' +
      s.toString(16).padStart(64, '0') +
      e.toString(16).padStart(64, '0')
    );
  }
}
