import { IdpDirectorySnapshot, IdpUserState, UnreadableIdpDirectoryRecordError } from '@pragmatic-tech-ai/todl-identity'
import type { IIdpDirectoryStore } from '@pragmatic-tech-ai/todl-identity'
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
    realms: Record<string, SnapshotRecord>
}

/** File-backed IdP directory snapshots, one per realm: user states and group member ids only. A stored record that
 *  does not parse (bad shape, unknown user state, invalid timestamp) fails closed: Get throws
 *  UnreadableIdpDirectoryRecordError for that realm instead of reading its users as Unknown (active); the next Save
 *  replaces it. */
export class FileIdpDirectoryStore implements IIdpDirectoryStore
{
    private static readonly FileName = 'idp-directory.json'
    private static readonly PairLength = 2
    private static readonly ShapeReason = 'record shape is invalid'
    private static readonly StateReason = 'unknown user state'
    private static readonly TakenAtReason = 'invalid snapshot timestamp'
    private static readonly States: ReadonlySet<string> = new Set<string>(Object.values(IdpUserState))

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
        const document = await file.Read<DirectoryDocument>({ realms: {} })
        return new FileIdpDirectoryStore(file, new Map(Object.entries(document.realms ?? {})))
    }

    public async Get(realmId: string): Promise<IdpDirectorySnapshot | null>
    {
        const record = this.records.get(realmId)
        if (record === undefined)
        {
            return null
        }
        return FileIdpDirectoryStore.Parse(realmId, record)
    }

    private static Parse(realmId: string, record: SnapshotRecord): IdpDirectorySnapshot
    {
        if (typeof record !== 'object' || record === null || typeof record.authoritative !== 'boolean'
            || typeof record.takenAt !== 'string' || !Array.isArray(record.users) || !Array.isArray(record.groups))
        {
            throw new UnreadableIdpDirectoryRecordError(realmId, FileIdpDirectoryStore.ShapeReason)
        }
        const takenAt = new Date(record.takenAt)
        if (Number.isNaN(takenAt.getTime()))
        {
            throw new UnreadableIdpDirectoryRecordError(realmId, FileIdpDirectoryStore.TakenAtReason)
        }
        const users = new Map<string, IdpUserState>()
        for (const entry of record.users as unknown[])
        {
            if (!Array.isArray(entry) || entry.length !== FileIdpDirectoryStore.PairLength || typeof entry[0] !== 'string')
            {
                throw new UnreadableIdpDirectoryRecordError(realmId, FileIdpDirectoryStore.ShapeReason)
            }
            if (typeof entry[1] !== 'string' || !FileIdpDirectoryStore.States.has(entry[1]))
            {
                throw new UnreadableIdpDirectoryRecordError(realmId, FileIdpDirectoryStore.StateReason)
            }
            users.set(entry[0], entry[1] as IdpUserState)
        }
        const groups = new Map<string, readonly string[]>()
        for (const entry of record.groups as unknown[])
        {
            if (!Array.isArray(entry) || entry.length !== FileIdpDirectoryStore.PairLength || typeof entry[0] !== 'string'
                || !Array.isArray(entry[1]) || (entry[1] as unknown[]).some(m => typeof m !== 'string'))
            {
                throw new UnreadableIdpDirectoryRecordError(realmId, FileIdpDirectoryStore.ShapeReason)
            }
            groups.set(entry[0], entry[1] as string[])
        }
        return new IdpDirectorySnapshot(takenAt, record.authoritative, users, groups)
    }

    public async Save(realmId: string, snapshot: IdpDirectorySnapshot): Promise<void>
    {
        const previous = this.records.get(realmId)
        this.records.set(realmId, {
            takenAt: snapshot.TakenAt.toISOString(),
            authoritative: snapshot.Authoritative,
            users: [...snapshot.Users()],
            groups: [...snapshot.Groups()].map(([id, members]) => [id, [...members]]),
        })
        try
        {
            await this.file.Write({ realms: Object.fromEntries(this.records) } satisfies DirectoryDocument)
        }
        catch (error)
        {
            if (previous === undefined)
            {
                this.records.delete(realmId)
            }
            else
            {
                this.records.set(realmId, previous)
            }
            throw error
        }
    }
}
