import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seal, unseal, WrongPassphrase } from '../../extension/src/vault.js';

const TOKEN = 'ghp_testtokentesttokentesttokentest0001';
const PASS = 'correct horse battery staple';

test('a sealed token opens with the same passphrase', async () => {
  assert.equal(await unseal(await seal(TOKEN, PASS), PASS), TOKEN);
});

test('the sealed record holds no trace of the token or the passphrase', async () => {
  const text = JSON.stringify(await seal(TOKEN, PASS));
  assert.ok(!text.includes(TOKEN) && !text.includes('ghp_') && !text.includes(PASS));
});

test('a wrong passphrase is refused', async () => {
  await assert.rejects(unseal(await seal(TOKEN, PASS), 'correct horse battery stapler'), WrongPassphrase);
});

test('a tampered ciphertext is refused, not decrypted into something else', async () => {
  const vault = await seal(TOKEN, PASS);
  const bytes = Uint8Array.from(atob(vault.ciphertext), c => c.charCodeAt(0));
  bytes[0] ^= 1;
  await assert.rejects(unseal({ ...vault, ciphertext: btoa(String.fromCharCode(...bytes)) }, PASS), WrongPassphrase);
});

test('every seal uses a fresh salt and IV', async () => {
  const [a, b] = [await seal(TOKEN, PASS), await seal(TOKEN, PASS)];
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ciphertext, b.ciphertext);
  assert.equal(a.iterations, 600_000);
});

test('a record that asks for fewer rounds than this version writes is not used', async () => {
  const vault = await seal(TOKEN, PASS);
  await assert.rejects(unseal({ ...vault, iterations: 1_000 }, PASS), /format this version cannot read/);
  await assert.rejects(unseal({ ...vault, v: 2 }, PASS), /format this version cannot read/);
});

test('the passphrase is compared after Unicode normalisation', async () => {
  const composed = 'café au lait, deux sucres';
  const decomposed = 'café au lait, deux sucres';
  assert.equal(await unseal(await seal(TOKEN, composed), decomposed), TOKEN);
});
