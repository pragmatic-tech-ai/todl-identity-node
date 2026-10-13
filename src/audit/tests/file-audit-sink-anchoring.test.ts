import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AuditEvent, AuditEventKind } from '@pragmatic-tech-ai/todl-identity'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { AuditAnchor, AuditAnchoring, AuditAnchorMismatch, HmacAuditCheckpointSigner } from '@pragmatic-tech-ai/todl-identity-host'
import { FileAuditSink } from '../file-audit-sink.js'
import { FileAuditCheckpointStore } from '../file-audit-checkpoint-store.js'

class AnchoringTestHarness
{
    private static readonly AuditFile = 'audit.json'
    private static readonly AnchorsFile = 'audit-anchors.json'
    private static readonly Key = 'test-key'

    public static Event(tenant: string, action: string): AuditEvent
    {
        return new AuditEvent(AuditEventKind.AdminAction, tenant, 'p1', new Date('2026-01-01T00:00:00Z'), new Map([['action', action]]))
    }

    public static async Anchoring(storage: FakeStorage, interval = 1): Promise<AuditAnchoring>
    {
        return new AuditAnchoring(new AuditAnchor(new HmacAuditCheckpointSigner(AnchoringTestHarness.Key), interval), await FileAuditCheckpointStore.Open(storage))
    }

    public static async ReadDoc(storage: FakeStorage): Promise<{ events: Array<Record<string, unknown>> }>
    {
        return JSON.parse(await storage.ReadText(AnchoringTestHarness.AuditFile))
    }

    public static async WriteDoc(storage: FakeStorage, doc: unknown): Promise<void>
    {
        await storage.WriteText(AnchoringTestHarness.AuditFile, JSON.stringify(doc))
    }

    public static async ReadAnchors(storage: FakeStorage): Promise<{ checkpoints: Array<Record<string, unknown>> }>
    {
        return JSON.parse(await storage.ReadText(AnchoringTestHarness.AnchorsFile))
    }

    public static async WriteAnchors(storage: FakeStorage, doc: unknown): Promise<void>
    {
        await storage.WriteText(AnchoringTestHarness.AnchorsFile, JSON.stringify(doc))
    }

    public static AnchorsExist(storage: FakeStorage): Promise<boolean>
    {
        return storage.Exists(AnchoringTestHarness.AnchorsFile)
    }
}

test('anchored records reopen clean', async () =>
{
    const storage = new FakeStorage()
    const sink = await FileAuditSink.Open(storage, await AnchoringTestHarness.Anchoring(storage))
    await sink.Record(AnchoringTestHarness.Event('t1', 'a'))
    await sink.Record(AnchoringTestHarness.Event('t1', 'b'))
    const reopened = await FileAuditSink.Open(storage, await AnchoringTestHarness.Anchoring(storage))
    assert.ok(reopened.Verify('t1'))
    assert.equal(reopened.Records('t1').length, 2)
})

test('tail-truncation of the event log is detected on reopen', async () =>
{
    const storage = new FakeStorage()
    const sink = await FileAuditSink.Open(storage, await AnchoringTestHarness.Anchoring(storage))
    await sink.Record(AnchoringTestHarness.Event('t1', 'a'))
    await sink.Record(AnchoringTestHarness.Event('t1', 'b'))
    const doc = await AnchoringTestHarness.ReadDoc(storage)
    doc.events = doc.events.slice(0, 1)
    await AnchoringTestHarness.WriteDoc(storage, doc)
    await assert.rejects(FileAuditSink.Open(storage, await AnchoringTestHarness.Anchoring(storage)), AuditAnchorMismatch)
})

test('deleting all of a tenant’s events is detected (truncate-to-zero)', async () =>
{
    const storage = new FakeStorage()
    const sink = await FileAuditSink.Open(storage, await AnchoringTestHarness.Anchoring(storage))
    await sink.Record(AnchoringTestHarness.Event('t1', 'a'))
    const doc = await AnchoringTestHarness.ReadDoc(storage)
    doc.events = []
    await AnchoringTestHarness.WriteDoc(storage, doc)
    await assert.rejects(FileAuditSink.Open(storage, await AnchoringTestHarness.Anchoring(storage)), AuditAnchorMismatch)
})

test('one tenant fully wiped while another survives is detected via the store-tenant union', async () =>
{
    const storage = new FakeStorage()
    const sink = await FileAuditSink.Open(storage, await AnchoringTestHarness.Anchoring(storage))
    await sink.Record(AnchoringTestHarness.Event('t1', 'a'))
    await sink.Record(AnchoringTestHarness.Event('t2', 'x'))
    const doc = await AnchoringTestHarness.ReadDoc(storage)
    doc.events = doc.events.filter(e => e.tenantId !== 't1')
    await AnchoringTestHarness.WriteDoc(storage, doc)
    await assert.rejects(FileAuditSink.Open(storage, await AnchoringTestHarness.Anchoring(storage)), AuditAnchorMismatch)
})

test('a consistent whole-file rewrite is detected as a mismatch', async () =>
{
    const storage = new FakeStorage()
    const sink = await FileAuditSink.Open(storage, await AnchoringTestHarness.Anchoring(storage))
    await sink.Record(AnchoringTestHarness.Event('t1', 'a'))
    await sink.Record(AnchoringTestHarness.Event('t1', 'b'))
    const forgedStorage = new FakeStorage()
    const forged = await FileAuditSink.Open(forgedStorage)
    await forged.Record(AnchoringTestHarness.Event('t1', 'forged-a'))
    await forged.Record(AnchoringTestHarness.Event('t1', 'forged-b'))
    const forgedDoc = await AnchoringTestHarness.ReadDoc(forgedStorage)
    await AnchoringTestHarness.WriteDoc(storage, forgedDoc)
    await assert.rejects(FileAuditSink.Open(storage, await AnchoringTestHarness.Anchoring(storage)), AuditAnchorMismatch)
})

test('a forged checkpoint signature is rejected', async () =>
{
    const storage = new FakeStorage()
    const sink = await FileAuditSink.Open(storage, await AnchoringTestHarness.Anchoring(storage))
    await sink.Record(AnchoringTestHarness.Event('t1', 'a'))
    const anchorsDoc = await AnchoringTestHarness.ReadAnchors(storage)
    anchorsDoc.checkpoints[0].signature = 'deadbeef'
    await AnchoringTestHarness.WriteAnchors(storage, anchorsDoc)
    await assert.rejects(FileAuditSink.Open(storage, await AnchoringTestHarness.Anchoring(storage)), AuditAnchorMismatch)
})

test('anchoring off leaves no anchors file and is byte-unchanged', async () =>
{
    const storage = new FakeStorage()
    const sink = await FileAuditSink.Open(storage)
    await sink.Record(AnchoringTestHarness.Event('t1', 'a'))
    assert.equal(await AnchoringTestHarness.AnchorsExist(storage), false)
    const reopened = await FileAuditSink.Open(storage)
    assert.ok(reopened.Verify('t1'))
})

test('interval N flushes the un-anchored tail on reopen, then truncation is caught', async () =>
{
    const storage = new FakeStorage()
    const sink = await FileAuditSink.Open(storage, await AnchoringTestHarness.Anchoring(storage, 5))
    await sink.Record(AnchoringTestHarness.Event('t1', 'a'))
    await sink.Record(AnchoringTestHarness.Event('t1', 'b'))
    const reopened = await FileAuditSink.Open(storage, await AnchoringTestHarness.Anchoring(storage, 5))
    assert.ok(reopened.Verify('t1'))
    const store = await FileAuditCheckpointStore.Open(storage)
    assert.equal((await store.Latest('t1'))!.Sequence, 2)
    const doc = await AnchoringTestHarness.ReadDoc(storage)
    doc.events = doc.events.slice(0, 1)
    await AnchoringTestHarness.WriteDoc(storage, doc)
    await assert.rejects(FileAuditSink.Open(storage, await AnchoringTestHarness.Anchoring(storage, 5)), AuditAnchorMismatch)
})

test('concurrent Records are serialized and reopen clean', async () =>
{
    const storage = new FakeStorage()
    const sink = await FileAuditSink.Open(storage, await AnchoringTestHarness.Anchoring(storage))
    await Promise.all([sink.Record(AnchoringTestHarness.Event('t1', 'a')), sink.Record(AnchoringTestHarness.Event('t1', 'b')), sink.Record(AnchoringTestHarness.Event('t1', 'c'))])
    assert.equal(sink.Records('t1').length, 3)
    const reopened = await FileAuditSink.Open(storage, await AnchoringTestHarness.Anchoring(storage))
    assert.ok(reopened.Verify('t1'))
    assert.equal(reopened.Records('t1').length, 3)
})
