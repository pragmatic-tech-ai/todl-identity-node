import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { AuditCheckpoint } from '@pragmatic-tech-ai/todl-identity-host'
import { FileAuditCheckpointStore } from '../file-audit-checkpoint-store.js'

test('appends persist to a separate file and survive a reopen; Latest is the highest seq', async () =>
{
    const storage = new FakeStorage()
    const store = await FileAuditCheckpointStore.Open(storage)
    await store.Append(new AuditCheckpoint('t1', 1, 'h1', 'a1', 's1'))
    await store.Append(new AuditCheckpoint('t1', 2, 'h2', 'a2', 's2'))
    await store.Append(new AuditCheckpoint('t2', 1, 'h3', 'a3', 's3'))
    assert.ok(await storage.Exists('audit-anchors.json'))
    const reopened = await FileAuditCheckpointStore.Open(storage)
    assert.equal((await reopened.Latest('t1'))!.Sequence, 2)
    assert.equal((await reopened.Latest('t1'))!.HeadHash, 'h2')
    assert.equal(await reopened.Latest('absent'), undefined)
    assert.deepEqual([...(await reopened.Tenants())].sort(), ['t1', 't2'])
})

test('concurrent appends are serialized and both persist across a reopen', async () =>
{
    const storage = new FakeStorage()
    const store = await FileAuditCheckpointStore.Open(storage)
    await Promise.all([store.Append(new AuditCheckpoint('t1', 1, 'h1', 'a1', 's1')), store.Append(new AuditCheckpoint('t1', 2, 'h2', 'a2', 's2'))])
    const reopened = await FileAuditCheckpointStore.Open(storage)
    assert.equal((await reopened.Latest('t1'))!.Sequence, 2)
    const tenants = await reopened.Tenants()
    assert.equal(tenants.length, 1)
})
