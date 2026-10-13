import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AuditEvent, AuditEventKind } from '@pragmatic-tech-ai/todl-identity'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { AuditTamperDetected } from '@pragmatic-tech-ai/todl-identity-host'
import { FileAuditSink } from '../file-audit-sink.js'

const event = new AuditEvent(AuditEventKind.AdminAction, 't1', 'p1', new Date('2026-01-01T00:00:00Z'), new Map([['action', 'register']]))

test('Record then Verify holds and Records returns the chain', async () =>
{
    const sink = await FileAuditSink.Open(new FakeStorage())
    await sink.Record(event)
    await sink.Record(event)
    assert.equal(sink.Records('t1').length, 2)
    assert.ok(sink.Verify('t1'))
})

test('the chain survives a reopen and still verifies', async () =>
{
    const storage = new FakeStorage()
    const first = await FileAuditSink.Open(storage)
    await first.Record(event)
    await first.Record(event)
    const firstHash = first.Records('t1')[1].Hash

    const second = await FileAuditSink.Open(storage)
    assert.equal(second.Records('t1').length, 2)
    assert.ok(second.Verify('t1'))
    assert.equal(second.Records('t1')[1].Hash, firstHash)
})

test('recorded detail is preserved; the sink adds no secret of its own', async () =>
{
    const storage = new FakeStorage()
    const sink = await FileAuditSink.Open(storage)
    await sink.Record(event)
    const onDisk = await storage.ReadText('audit.json')
    assert.ok(onDisk.includes('register'))
    assert.ok(!onDisk.toLowerCase().includes('password'))
})

const ReadDoc = async (storage: FakeStorage): Promise<{ events: Array<Record<string, unknown>> }> => JSON.parse(await storage.ReadText('audit.json'))
const WriteDoc = async (storage: FakeStorage, doc: unknown): Promise<void> => storage.WriteText('audit.json', JSON.stringify(doc))
const Raw = (tenantId: string, action: string): Record<string, unknown> => ({ kind: AuditEventKind.AdminAction, tenantId, principalId: 'p1', at: '2026-01-01T00:00:00.000Z', detail: [['action', action]] })

test('hash and prevHash are persisted and equal Records', async () =>
{
    const storage = new FakeStorage()
    const sink = await FileAuditSink.Open(storage)
    await sink.Record(event)
    await sink.Record(event)
    const doc = await ReadDoc(storage)
    const records = sink.Records('t1')
    for (let i = 0; i < 2; i++)
    {
        assert.ok(doc.events[i].hash)
        assert.equal(doc.events[i].hash, records[i].Hash)
        assert.equal(doc.events[i].prevHash, records[i].PrevHash)
    }
})

test('clean reopen verifies with identical hashes', async () =>
{
    const storage = new FakeStorage()
    const first = await FileAuditSink.Open(storage)
    await first.Record(event)
    await first.Record(event)
    const second = await FileAuditSink.Open(storage)
    assert.ok(second.Verify('t1'))
    assert.deepEqual(second.Records('t1').map(r => r.Hash), first.Records('t1').map(r => r.Hash))
})

test('tampered detail makes Open throw', async () =>
{
    const storage = new FakeStorage()
    const sink = await FileAuditSink.Open(storage)
    await sink.Record(event)
    const doc = await ReadDoc(storage)
    doc.events[0].detail = [['action', 'forged']]
    await WriteDoc(storage, doc)
    await assert.rejects(FileAuditSink.Open(storage), AuditTamperDetected)
})

test('tampered hash makes Open throw', async () =>
{
    const storage = new FakeStorage()
    const sink = await FileAuditSink.Open(storage)
    await sink.Record(event)
    const doc = await ReadDoc(storage)
    doc.events[0].hash = 'deadbeef'
    await WriteDoc(storage, doc)
    await assert.rejects(FileAuditSink.Open(storage), AuditTamperDetected)
})

test('legacy file without hashes is backfilled then verifies clean', async () =>
{
    const storage = new FakeStorage()
    await WriteDoc(storage, { events: [Raw('t1', 'a'), Raw('t1', 'b')] })
    const first = await FileAuditSink.Open(storage)
    assert.ok(first.Verify('t1'))
    const doc = await ReadDoc(storage)
    assert.ok(doc.events.every(e => typeof e.hash === 'string' && typeof e.prevHash === 'string'))
    const second = await FileAuditSink.Open(storage)
    assert.ok(second.Verify('t1'))
    assert.equal(second.Records('t1')[1].Hash, first.Records('t1')[1].Hash)
})

test('a hashless record after a hashed one for the same tenant throws', async () =>
{
    const storage = new FakeStorage()
    const sink = await FileAuditSink.Open(storage)
    await sink.Record(event)
    const doc = await ReadDoc(storage)
    doc.events.push(Raw('t1', 'late'))
    await WriteDoc(storage, doc)
    await assert.rejects(FileAuditSink.Open(storage), AuditTamperDetected)
})

test('interleaved tenants each verify with correct per-tenant sequence', async () =>
{
    const storage = new FakeStorage()
    const sink = await FileAuditSink.Open(storage)
    const other = new AuditEvent(AuditEventKind.AdminAction, 't2', 'p1', new Date('2026-01-01T00:00:00Z'), new Map([['action', 'x']]))
    await sink.Record(event)
    await sink.Record(other)
    await sink.Record(event)
    await sink.Record(other)
    const reopened = await FileAuditSink.Open(storage)
    assert.ok(reopened.Verify('t1'))
    assert.ok(reopened.Verify('t2'))
    assert.equal(reopened.Records('t1').length, 2)
    assert.equal(reopened.Records('t2').length, 2)
})
