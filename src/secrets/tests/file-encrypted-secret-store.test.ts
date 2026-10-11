import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { FileEncryptedSecretStore } from '../file-encrypted-secret-store.js'

const SecretsFile = 'secrets.json'

test('Put then Get round-trips the plaintext', async () =>
{
    const store = await FileEncryptedSecretStore.Open(new FakeStorage(), randomBytes(32))
    await store.Put('ref-1', 'hunter2')
    assert.equal(await store.Get('ref-1'), 'hunter2')
})

test('plaintext never reaches disk — only ciphertext is persisted', async () =>
{
    const storage = new FakeStorage()
    const store = await FileEncryptedSecretStore.Open(storage, randomBytes(32))
    await store.Put('ref-1', 'top-secret-value')
    const onDisk = await storage.ReadText(SecretsFile)
    assert.ok(!onDisk.includes('top-secret-value'))
})

test('reopening over the same file and key recovers the secret', async () =>
{
    const storage = new FakeStorage()
    const key = randomBytes(32)
    const first = await FileEncryptedSecretStore.Open(storage, key)
    await first.Put('ref-1', 'persisted')
    const second = await FileEncryptedSecretStore.Open(storage, Buffer.from(key))
    assert.equal(await second.Get('ref-1'), 'persisted')
})

test('a wrong master key fails closed (Get returns null, no throw)', async () =>
{
    const storage = new FakeStorage()
    const first = await FileEncryptedSecretStore.Open(storage, randomBytes(32))
    await first.Put('ref-1', 'persisted')
    const second = await FileEncryptedSecretStore.Open(storage, randomBytes(32))
    assert.equal(await second.Get('ref-1'), null)
})

test('Get on an unknown reference returns null', async () =>
{
    const store = await FileEncryptedSecretStore.Open(new FakeStorage(), randomBytes(32))
    assert.equal(await store.Get('missing'), null)
})
