import { AuditEvent } from '@pragmatic-tech-ai/todl-identity'
import type { AuditEventKind, IAuditSink } from '@pragmatic-tech-ai/todl-identity'
import { AuditTamperDetected, HashChainedAuditSink } from '@pragmatic-tech-ai/todl-identity-host'
import type { AuditAnchoring, ChainedAuditRecord } from '@pragmatic-tech-ai/todl-identity-host'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { JsonFile } from '../storage/json-file.js'

interface EventRecord
{
    kind: AuditEventKind
    realmId: string
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
 *  per-realm sequence gap throws AuditTamperDetected). Legacy files with no hashes are backfilled
 *  prefix-only (a hashless record after a hashed one for the same realm is tamper). Concurrent
 *  full-file rewrites across processes remain OUT OF SCOPE (single-node store); in-process
 *  Record calls are serialized on one sink-wide queue. */
export class FileAuditSink implements IAuditSink
{
    private static readonly FileName = 'audit.json'

    private readonly file: JsonFile
    private readonly chain: HashChainedAuditSink
    private readonly events: EventRecord[]
    private readonly anchoring?: AuditAnchoring
    private writes: Promise<unknown> = Promise.resolve()

    private constructor(file: JsonFile, chain: HashChainedAuditSink, events: EventRecord[], anchoring?: AuditAnchoring)
    {
        this.file = file
        this.chain = chain
        this.events = events
        this.anchoring = anchoring
    }

    public static async Open(storage: IStorage, anchoring?: AuditAnchoring): Promise<FileAuditSink>
    {
        const file = new JsonFile(storage, FileAuditSink.FileName)
        const document = await file.Read<AuditDocument>({ events: [] })
        const chain = new HashChainedAuditSink()
        const hashedRealms = new Set<string>()
        let dirty = false
        for (const record of document.events)
        {
            const event = FileAuditSink.ToEvent(record)
            const expected = chain.Next(event.RealmId, event)
            if (record.hash === undefined)
            {
                if (hashedRealms.has(event.RealmId))
                {
                    throw new AuditTamperDetected(event.RealmId, expected.Sequence)
                }
                record.hash = expected.Hash
                record.prevHash = expected.PrevHash
                dirty = true
            }
            else
            {
                if (record.hash !== expected.Hash || record.prevHash !== expected.PrevHash)
                {
                    throw new AuditTamperDetected(event.RealmId, expected.Sequence)
                }
                hashedRealms.add(event.RealmId)
            }
            chain.Append(expected)
        }
        if (dirty)
        {
            await file.Write({ events: document.events } satisfies AuditDocument)
        }
        if (anchoring !== undefined)
        {
            const realms = [...new Set(document.events.map(e => e.realmId))]
            await anchoring.VerifyAll(chain, realms)
        }
        return new FileAuditSink(file, chain, [...document.events], anchoring)
    }

    public Record(event: AuditEvent): Promise<void>
    {
        const run = this.writes.then(() => this.Commit(event))
        this.writes = run.catch(() => undefined)
        return run
    }

    private async Commit(event: AuditEvent): Promise<void>
    {
        const next = this.chain.Next(event.RealmId, event)
        const record: EventRecord = { kind: event.Kind, realmId: event.RealmId, principalId: event.PrincipalId, at: event.At.toISOString(), detail: [...event.Detail], hash: next.Hash, prevHash: next.PrevHash }
        await this.file.Write({ events: [...this.events, record] } satisfies AuditDocument)
        this.events.push(record)
        this.chain.Append(next)
        // The event is already durable and chained above; a throw here only means its checkpoint
        // lag is caught as an un-anchored tail on the next Open (never a checkpoint ahead of its event).
        if (this.anchoring !== undefined)
        {
            await this.anchoring.CheckpointIfDue(event.RealmId, this.chain.Records(event.RealmId))
        }
    }

    public Verify(realmId: string): boolean
    {
        return this.chain.Verify(realmId)
    }

    public Records(realmId: string): readonly ChainedAuditRecord[]
    {
        return this.chain.Records(realmId)
    }

    private static ToEvent(record: EventRecord): AuditEvent
    {
        return new AuditEvent(record.kind, record.realmId, record.principalId, new Date(record.at), new Map(record.detail))
    }
}
