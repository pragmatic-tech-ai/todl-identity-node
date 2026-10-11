import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AuditEvent, AuditEventKind } from '@pragmatic-tech-ai/todl-identity'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
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
