import { AuditCheckpoint } from '@pragmatic-tech-ai/todl-identity-host'
import type { IAuditCheckpointStore } from '@pragmatic-tech-ai/todl-identity-host'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { JsonFile } from '../storage/json-file.js'

interface CheckpointRecord
{
    tenantId: string
    sequence: number
    headHash: string
    at: string
    signature: string
}

interface AnchorDocument
{
    checkpoints: CheckpointRecord[]
}

/** Append-only store of signed audit checkpoints, persisted to a file SEPARATE from the event log
 *  (audit-anchors.json). Independence from the event log is what lets FileAuditSink.Open detect
 *  tail-truncation / whole-file rewrite; the HMAC signature (key held outside the store) is what
 *  prevents forging a checkpoint. Wholesale deletion of this file is out of scope (see spec §7). */
export class FileAuditCheckpointStore implements IAuditCheckpointStore
{
    private static readonly FileName = 'audit-anchors.json'

    private readonly file: JsonFile
    private readonly checkpoints: CheckpointRecord[]

    private constructor(file: JsonFile, checkpoints: CheckpointRecord[])
    {
        this.file = file
        this.checkpoints = checkpoints
    }

    public static async Open(storage: IStorage): Promise<FileAuditCheckpointStore>
    {
        const file = new JsonFile(storage, FileAuditCheckpointStore.FileName)
        const document = await file.Read<AnchorDocument>({ checkpoints: [] })
        return new FileAuditCheckpointStore(file, [...document.checkpoints])
    }

    public Latest(tenantId: string): Promise<AuditCheckpoint | undefined>
    {
        let best: CheckpointRecord | undefined
        for (const record of this.checkpoints)
        {
            if (record.tenantId === tenantId && (best === undefined || record.sequence > best.sequence))
            {
                best = record
            }
        }
        return Promise.resolve(best === undefined
            ? undefined
            : new AuditCheckpoint(best.tenantId, best.sequence, best.headHash, best.at, best.signature))
    }

    public async Append(checkpoint: AuditCheckpoint): Promise<void>
    {
        const record: CheckpointRecord = { tenantId: checkpoint.TenantId, sequence: checkpoint.Sequence, headHash: checkpoint.HeadHash, at: checkpoint.At, signature: checkpoint.Signature }
        await this.file.Write({ checkpoints: [...this.checkpoints, record] } satisfies AnchorDocument)
        this.checkpoints.push(record)
    }

    public Tenants(): Promise<readonly string[]>
    {
        return Promise.resolve([...new Set(this.checkpoints.map(r => r.tenantId))])
    }
}
