import { AuditEvent } from '@pragmatic-tech-ai/todl-identity'
import type { AuditEventKind, IAuditSink } from '@pragmatic-tech-ai/todl-identity'
import { AuditTamperDetected, HashChainedAuditSink } from '@pragmatic-tech-ai/todl-identity-host'
import type { ChainedAuditRecord } from '@pragmatic-tech-ai/todl-identity-host'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { JsonFile } from '../storage/json-file.js'

interface EventRecord
{
    kind: AuditEventKind
    tenantId: string
    principalId: string | null
    at: string
    detail: Array<[string, string]>
    hash?: string
    prevHash?: string
}

interface AuditDocument
{
    events: EventRecord[]
}

/** Persistent, tamper-evident audit sink. Chaining is delegated to the host HashChainedAuditSink;
 *  the ordered event log is persisted with each event's hash/prevHash and replayed on open. Open
 *  recomputes the chain and verifies it against the persisted hashes (fail-closed: a mismatch or a
 *  per-tenant sequence gap throws AuditTamperDetected). Legacy files with no hashes are backfilled
 *  prefix-only (a hashless record after a hashed one for the same tenant is tamper). Concurrent
 *  full-file rewrites across processes remain OUT OF SCOPE (single-node store); in-process
 *  Record calls are serialized on one sink-wide queue. */
export class FileAuditSink implements IAuditSink
{
    private static readonly FileName = 'audit.json'

    private readonly file: JsonFile
    private readonly chain: HashChainedAuditSink
    private readonly events: EventRecord[]
    private writes: Promise<unknown> = Promise.resolve()

    private constructor(file: JsonFile, chain: HashChainedAuditSink, events: EventRecord[])
    {
        this.file = file
        this.chain = chain
        this.events = events
    }

    public static async Open(storage: IStorage): Promise<FileAuditSink>
    {
        const file = new JsonFile(storage, FileAuditSink.FileName)
        const document = await file.Read<AuditDocument>({ events: [] })
        const chain = new HashChainedAuditSink()
        const seen = new Map<string, number>()
        const hashedTenants = new Set<string>()
        let dirty = false
        for (const record of document.events)
        {
            const event = FileAuditSink.ToEvent(record)
            const expected = chain.Next(event.TenantId, event)
            const count = seen.get(event.TenantId) ?? 0
            if (expected.Sequence !== count)
            {
                throw new AuditTamperDetected(event.TenantId, expected.Sequence)
            }
            seen.set(event.TenantId, count + 1)
            if (record.hash === undefined)
            {
                if (hashedTenants.has(event.TenantId))
                {
                    throw new AuditTamperDetected(event.TenantId, expected.Sequence)
                }
                record.hash = expected.Hash
                record.prevHash = expected.PrevHash
                dirty = true
            }
            else
            {
                if (record.hash !== expected.Hash || record.prevHash !== expected.PrevHash)
                {
                    throw new AuditTamperDetected(event.TenantId, expected.Sequence)
                }
                hashedTenants.add(event.TenantId)
            }
            chain.Append(expected)
        }
        if (dirty)
        {
            await file.Write({ events: document.events } satisfies AuditDocument)
        }
        return new FileAuditSink(file, chain, [...document.events])
    }

    public Record(event: AuditEvent): Promise<void>
    {
        const run = this.writes.then(() => this.Commit(event))
        this.writes = run.catch(() => undefined)
        return run
    }

    private async Commit(event: AuditEvent): Promise<void>
    {
        const next = this.chain.Next(event.TenantId, event)
        const record: EventRecord = { kind: event.Kind, tenantId: event.TenantId, principalId: event.PrincipalId, at: event.At.toISOString(), detail: [...event.Detail], hash: next.Hash, prevHash: next.PrevHash }
        await this.file.Write({ events: [...this.events, record] } satisfies AuditDocument)
        this.events.push(record)
        this.chain.Append(next)
    }

    public Verify(tenantId: string): boolean
    {
        return this.chain.Verify(tenantId)
    }

    public Records(tenantId: string): readonly ChainedAuditRecord[]
    {
        return this.chain.Records(tenantId)
    }

    private static ToEvent(record: EventRecord): AuditEvent
    {
        return new AuditEvent(record.kind, record.tenantId, record.principalId, new Date(record.at), new Map(record.detail))
    }
}
