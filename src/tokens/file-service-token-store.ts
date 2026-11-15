import { randomBytes, createHash } from 'node:crypto'
import { ServiceTokenGrant, ServiceTokenSummary } from '@pragmatic-tech-ai/todl-identity'
import type { IServiceTokenStore, Realm, PresentedSecret } from '@pragmatic-tech-ai/todl-identity'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { JsonFile } from '../storage/json-file.js'
import { LegacyRealmNames } from '../storage/legacy-realm-names.js'

interface GrantRecord
{
    tokenRef: string
    principalId: string
    realmId: string
    scopes: string[]
    expiresAt: string | null
    revoked: boolean
}

interface TokenDocument
{
    records: Record<string, GrantRecord>
}

export class FileServiceTokenStore implements IServiceTokenStore
{
    private static readonly FileName = 'service-tokens.json'
    private static readonly TokenBytes = 32
    private static readonly TokenEncoding = 'base64url'
    private static readonly HashAlgorithm = 'sha256'
    private static readonly HashEncoding = 'base64url'
    private static readonly RefSegment = '/svctok/'
    private static readonly RefSeparator = '/'

    private readonly file: JsonFile
    private readonly records: Map<string, GrantRecord>
    private readonly now: () => Date

    private constructor(file: JsonFile, records: Map<string, GrantRecord>, now: () => Date)
    {
        this.file = file
        this.records = records
        this.now = now
    }

    public static async Open(storage: IStorage, now: () => Date = () => new Date()): Promise<FileServiceTokenStore>
    {
        const file = new JsonFile(storage, FileServiceTokenStore.FileName)
        const document = await file.Read<TokenDocument>({ records: {} })
        LegacyRealmNames.UpgradeValues(document.records, LegacyRealmNames.LegacyRealmId, LegacyRealmNames.RealmId)
        return new FileServiceTokenStore(file, new Map(Object.entries(document.records)), now)
    }

    public async Issue(realm: Realm, principalId: string, scopes: readonly string[], expiresAt: Date | null): Promise<{ Grant: ServiceTokenGrant; Token: string }>
    {
        const token = randomBytes(FileServiceTokenStore.TokenBytes).toString(FileServiceTokenStore.TokenEncoding)
        const hash = this.hash(token)
        const tokenRef = realm.Id + FileServiceTokenStore.RefSegment + hash
        const record: GrantRecord = { tokenRef, principalId, realmId: realm.Id, scopes: [...scopes], expiresAt: expiresAt === null ? null : expiresAt.toISOString(), revoked: false }
        this.records.set(hash, record)
        await this.persist()
        return { Grant: FileServiceTokenStore.ToGrant(record), Token: token }
    }

    public async Resolve(realm: Realm, presented: PresentedSecret): Promise<ServiceTokenGrant | null>
    {
        const record = this.records.get(this.hash(presented.Reveal()))
        if (record === undefined || record.revoked || record.realmId !== realm.Id)
        {
            return null
        }
        if (record.expiresAt !== null && new Date(record.expiresAt).getTime() <= this.now().getTime())
        {
            return null
        }
        return FileServiceTokenStore.ToGrant(record)
    }

    public async Revoke(realm: Realm, tokenRef: string): Promise<void>
    {
        const hash = tokenRef.slice(tokenRef.lastIndexOf(FileServiceTokenStore.RefSeparator) + 1)
        const record = this.records.get(hash)
        if (record !== undefined && record.tokenRef === tokenRef && record.realmId === realm.Id)
        {
            record.revoked = true
            await this.persist()
        }
    }

    public async List(realm: Realm): Promise<readonly ServiceTokenSummary[]>
    {
        const summaries: ServiceTokenSummary[] = []
        for (const record of this.records.values())
        {
            if (record.realmId === realm.Id)
            {
                summaries.push(new ServiceTokenSummary(record.tokenRef, record.principalId, [...record.scopes], record.expiresAt === null ? null : new Date(record.expiresAt), record.revoked))
            }
        }
        return summaries
    }

    private persist(): Promise<void>
    {
        return this.file.Write({ records: Object.fromEntries(this.records) } satisfies TokenDocument)
    }

    private hash(token: string): string
    {
        return createHash(FileServiceTokenStore.HashAlgorithm).update(token).digest(FileServiceTokenStore.HashEncoding)
    }

    private static ToGrant(record: GrantRecord): ServiceTokenGrant
    {
        return new ServiceTokenGrant(record.tokenRef, record.principalId, record.realmId, [...record.scopes], record.expiresAt === null ? null : new Date(record.expiresAt))
    }
}
