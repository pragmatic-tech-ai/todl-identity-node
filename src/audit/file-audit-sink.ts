import { AuditEvent } from '@pragmatic-tech-ai/todl-identity'
import type { AuditEventKind, IAuditSink } from '@pragmatic-tech-ai/todl-identity'
import { HashChainedAuditSink } from '@pragmatic-tech-ai/todl-identity-host'
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
}

interface AuditDocument
{
    events: EventRecord[]
}

/** Persistent, tamper-evident audit sink. Chaining is delegated to the host HashChainedAuditSink;
 *  the ordered event log is persisted and replayed on open, so the deterministic chain survives restarts. */
export class FileAuditSink implements IAuditSink
{
    private static readonly FileName = 'audit.json'

    private readonly file: JsonFile
    private readonly chain: HashChainedAuditSink
    private readonly events: EventRecord[]

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
        for (const record of document.events)
        {
            await chain.Record(FileAuditSink.ToEvent(record))
        }
        return new FileAuditSink(file, chain, [...document.events])
    }

    public async Record(event: AuditEvent): Promise<void>
    {
        await this.chain.Record(event)
        this.events.push({ kind: event.Kind, tenantId: event.TenantId, principalId: event.PrincipalId, at: event.At.toISOString(), detail: [...event.Detail] })
        await this.file.Write({ events: this.events } satisfies AuditDocument)
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
