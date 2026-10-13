import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AuditEvent, AuditEventKind } from '@pragmatic-tech-ai/todl-identity'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { AuditAnchor, AuditAnchoring, AuditAnchorMismatch, HmacAuditCheckpointSigner } from '@pragmatic-tech-ai/todl-identity-host'
import { FileAuditSink } from '../file-audit-sink.js'
import { FileAuditCheckpointStore } from '../file-audit-checkpoint-store.js'

const event = (t: string, action: string) => new AuditEvent(AuditEventKind.AdminAction, t, 'p1', new Date('2026-01-01T00:00:00Z'), new Map([['action', action]]))

const anchoring = async (storage: FakeStorage, interval = 1) =>
    new AuditAnchoring(new AuditAnchor(new HmacAuditCheckpointSigner('test-key'), interval), await FileAuditCheckpointStore.Open(storage))

async function readDoc(storage: FakeStorage): Promise<{ events: Array<Record<string, unknown>> }>
{
    return JSON.parse(await storage.ReadText('audit.json'))
}

async function writeDoc(storage: FakeStorage, doc: unknown): Promise<void>
{
    await storage.WriteText('audit.json', JSON.stringify(doc))
}

test('anchored records reopen clean', async () =>
{
    const storage = new FakeStorage()
    const sink = await FileAuditSink.Open(storage, await anchoring(storage))
    await sink.Record(event('t1', 'a'))
    await sink.Record(event('t1', 'b'))
    const reopened = await FileAuditSink.Open(storage, await anchoring(storage))
    assert.ok(reopened.Verify('t1'))
    assert.equal(reopened.Records('t1').length, 2)
})

test('tail-truncation of the event log is detected on reopen', async () =>
{
    const storage = new FakeStorage()
    const sink = await FileAuditSink.Open(storage, await anchoring(storage))
    await sink.Record(event('t1', 'a'))
    await sink.Record(event('t1', 'b'))
    const doc = await readDoc(storage)
    doc.events = doc.events.slice(0, 1) // drop the last event
    await writeDoc(storage, doc)
    await assert.rejects(FileAuditSink.Open(storage, await anchoring(storage)), AuditAnchorMismatch)
})

test('deleting ALL of a tenant’s events is detected (truncate-to-zero)', async () =>
{
    const storage = new FakeStorage()
    const sink = await FileAuditSink.Open(storage, await anchoring(storage))
    await sink.Record(event('t1', 'a'))
    const doc = await readDoc(storage)
    doc.events = []
    await writeDoc(storage, doc)
    await assert.rejects(FileAuditSink.Open(storage, await anchoring(storage)), AuditAnchorMismatch)
})

test('a consistent whole-file rewrite is detected as divergence', async () =>
{
    const storage = new FakeStorage()
    const sink = await FileAuditSink.Open(storage, await anchoring(storage))
    await sink.Record(event('t1', 'a'))
    await sink.Record(event('t1', 'b'))
    // Rebuild a fresh, internally-consistent chain over forged events in a NEW sink (no anchoring),
    // then verify the ORIGINAL anchor store rejects it.
    const forgedStorage = new FakeStorage()
    const forged = await FileAuditSink.Open(forgedStorage)
    await forged.Record(event('t1', 'forged-a'))
    await forged.Record(event('t1', 'forged-b'))
    const forgedDoc = await readDoc(forgedStorage)
    await writeDoc(storage, forgedDoc) // swap the event log, keep the original anchors file
    await assert.rejects(FileAuditSink.Open(storage, await anchoring(storage)), AuditAnchorMismatch)
})

test('a forged checkpoint signature is rejected', async () =>
{
    const storage = new FakeStorage()
    const sink = await FileAuditSink.Open(storage, await anchoring(storage))
    await sink.Record(event('t1', 'a'))
    const anchorsDoc = JSON.parse(await storage.ReadText('audit-anchors.json'))
    anchorsDoc.checkpoints[0].signature = 'deadbeef'
    await storage.WriteText('audit-anchors.json', JSON.stringify(anchorsDoc))
    await assert.rejects(FileAuditSink.Open(storage, await anchoring(storage)), AuditAnchorMismatch)
})

test('anchoring off leaves no anchors file and is byte-unchanged', async () =>
{
    const storage = new FakeStorage()
    const sink = await FileAuditSink.Open(storage)
    await sink.Record(event('t1', 'a'))
    assert.equal(await storage.Exists('audit-anchors.json'), false)
    const reopened = await FileAuditSink.Open(storage)
    assert.ok(reopened.Verify('t1'))
})

test('interval N flushes the un-anchored tail on reopen, then truncation is caught', async () =>
{
    const storage = new FakeStorage()
    const sink = await FileAuditSink.Open(storage, await anchoring(storage, 5))
    await sink.Record(event('t1', 'a'))
    await sink.Record(event('t1', 'b')) // 2 < interval 5, no checkpoint yet
    // Reopen flushes a checkpoint at the current head (seq 2).
    const reopened = await FileAuditSink.Open(storage, await anchoring(storage, 5))
    assert.ok(reopened.Verify('t1'))
    const store = await FileAuditCheckpointStore.Open(storage)
    assert.equal((await store.Latest('t1'))!.Sequence, 2)
    // Now truncating below 2 is caught.
    const doc = await readDoc(storage)
    doc.events = doc.events.slice(0, 1)
    await writeDoc(storage, doc)
    await assert.rejects(FileAuditSink.Open(storage, await anchoring(storage, 5)), AuditAnchorMismatch)
})

test('concurrent Records are serialized and reopen clean', async () =>
{
    const storage = new FakeStorage()
    const sink = await FileAuditSink.Open(storage, await anchoring(storage))
    await Promise.all([sink.Record(event('t1', 'a')), sink.Record(event('t1', 'b')), sink.Record(event('t1', 'c'))])
    assert.equal(sink.Records('t1').length, 3)
    const reopened = await FileAuditSink.Open(storage, await anchoring(storage))
    assert.ok(reopened.Verify('t1'))
    assert.equal(reopened.Records('t1').length, 3)
})
