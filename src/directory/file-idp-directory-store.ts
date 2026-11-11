import { IdpDirectorySnapshot } from '@pragmatic-tech-ai/todl-identity'
import type { IIdpDirectoryStore, IdpUserState } from '@pragmatic-tech-ai/todl-identity'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { JsonFile } from '../storage/json-file.js'

interface SnapshotRecord
{
    takenAt: string
    authoritative: boolean
    users: Array<[string, IdpUserState]>
    groups: Array<[string, string[]]>
}

interface DirectoryDocument
{
    tenants: Record<string, SnapshotRecord>
}

/** File-backed IdP directory snapshots, one per tenant: user states and group member ids only. */
export class FileIdpDirectoryStore implements IIdpDirectoryStore
{
    private static readonly FileName = 'idp-directory.json'

    private readonly file: JsonFile
    private readonly records: Map<string, SnapshotRecord>

    private constructor(file: JsonFile, records: Map<string, SnapshotRecord>)
    {
        this.file = file
        this.records = records
    }

    public static async Open(storage: IStorage): Promise<FileIdpDirectoryStore>
    {
        const file = new JsonFile(storage, FileIdpDirectoryStore.FileName)
        const document = await file.Read<DirectoryDocument>({ tenants: {} })
        return new FileIdpDirectoryStore(file, new Map(Object.entries(document.tenants ?? {})))
    }

    public async Get(tenantId: string): Promise<IdpDirectorySnapshot | null>
    {
        const record = this.records.get(tenantId)
        if (record === undefined)
        {
            return null
        }
        return new IdpDirectorySnapshot(new Date(record.takenAt), record.authoritative, new Map(record.users), new Map(record.groups))
    }

    public async Save(tenantId: string, snapshot: IdpDirectorySnapshot): Promise<void>
    {
        const previous = this.records.get(tenantId)
        this.records.set(tenantId, {
            takenAt: snapshot.TakenAt.toISOString(),
            authoritative: snapshot.Authoritative,
            users: [...snapshot.Users()],
            groups: [...snapshot.Groups()].map(([id, members]) => [id, [...members]]),
        })
        try
        {
            await this.file.Write({ tenants: Object.fromEntries(this.records) } satisfies DirectoryDocument)
        }
        catch (error)
        {
            if (previous === undefined)
            {
                this.records.delete(tenantId)
            }
            else
            {
                this.records.set(tenantId, previous)
            }
            throw error
        }
    }
}
