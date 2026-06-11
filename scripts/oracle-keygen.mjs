#!/usr/bin/env node
// Generates a Grumpkin Schnorr oracle keypair for the v3 ZK circuit.
//
//   node scripts/oracle-keygen.mjs
//
// Prints the private key (set as ORACLE_SCHNORR_PRIVATE_KEY in the backend
// env) and the public key constants to pin in
// GrantOS-Contracts/circuits/src/main.nr (ORACLE_PUB_X / ORACLE_PUB_Y).
// After pinning, recompile the circuit and propagate the artifact + hash pins
// (see the comment block above NEXT_PUBLIC_ZK_CIRCUIT_HASH in the frontend
// .env.deploy).

import { randomBytes } from 'crypto';

const P = BigInt('0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001');
const N = BigInt('0x30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47');
const G = {
  x: 1n,
  y: BigInt('0x0000000000000002cf135e7506a45d632d270d45f1181294833fc48d823f272c'),
};

const mod = (a, m) => ((a % m) + m) % m;
const inv = (a, m) => {
  let [g, x] = [m, 0n];
  let [r, s] = [mod(a, m), 1n];
  while (r) {
    const q = g / r;
    [g, r] = [r, g - q * r];
    [x, s] = [s, x - q * s];
  }
  if (g !== 1n) throw new Error('no inverse');
  return mod(x, m);
};
const INF = { infinite: true };
const add = (a, b) => {
  if (a.infinite) return b;
  if (b.infinite) return a;
  if (a.x === b.x) {
    if (mod(a.y + b.y, P) === 0n) return INF;
    const l = mod(3n * a.x * a.x * inv(2n * a.y, P), P);
    const x = mod(l * l - 2n * a.x, P);
    return { x, y: mod(l * (a.x - x) - a.y, P) };
  }
  const l = mod((b.y - a.y) * inv(b.x - a.x, P), P);
  const x = mod(l * l - a.x - b.x, P);
  return { x, y: mod(l * (a.x - x) - a.y, P) };
};
const mul = (p, k) => {
  let r = INF;
  let q = p;
  k = mod(k, N);
  while (k) {
    if (k & 1n) r = add(r, q);
    q = add(q, q);
    k >>= 1n;
  }
  return r;
};

let sk = 0n;
while (sk === 0n) sk = mod(BigInt('0x' + randomBytes(32).toString('hex')), N);
const pk = mul(G, sk);

const hex = (v) => '0x' + v.toString(16).padStart(64, '0');
console.log('Grumpkin Schnorr oracle keypair generated.\n');
console.log('Backend env (.env / Render dashboard) — keep secret:');
console.log(`  ORACLE_SCHNORR_PRIVATE_KEY=${hex(sk)}\n`);
console.log('Circuit constants (GrantOS-Contracts/circuits/src/main.nr):');
console.log(`  global ORACLE_PUB_X: Field = ${hex(pk.x)};`);
console.log(`  global ORACLE_PUB_Y: Field = ${hex(pk.y)};`);
