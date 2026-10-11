import { randomBytes, createHash } from 'node:crypto'
import { Session, AuthMethod } from '@pragmatic-tech-ai/todl-identity'
import type { ISessionManager, Principal } from '@pragmatic-tech-ai/todl-identity'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { JsonFile } from '../storage/json-file.js'

interface SessionRecord
{
    principalId: string
    tenantId: string
    issuedAt: string
    expiresAt: string
}

interface SessionDocument
{
    sessions: Record<string, SessionRecord>
}

export class FileSessionStore implements ISessionManager
{
    private static readonly FileName = 'sessions.json'
    private static readonly DefaultTtlMs = 3_600_000
    private static readonly TokenBytes = 32
    private static readonly TokenEncoding = 'base64url'
    private static readonly HashAlgorithm = 'sha256'
    private static readonly HashEncoding = 'base64url'

    private readonly file: JsonFile
    private readonly sessions: Map<string, SessionRecord>
    private readonly ttlMs: number
    private readonly now: () => Date

    private constructor(file: JsonFile, sessions: Map<string, SessionRecord>, ttlMs: number, now: () => Date)
    {
        this.file = file
        this.sessions = sessions
        this.ttlMs = ttlMs
        this.now = now
    }

    public static async Open(storage: IStorage, ttlMs: number = FileSessionStore.DefaultTtlMs, now: () => Date = () => new Date()): Promise<FileSessionStore>
    {
        const file = new JsonFile(storage, FileSessionStore.FileName)
        const document = await file.Read<SessionDocument>({ sessions: {} })
        return new FileSessionStore(file, new Map(Object.entries(document.sessions)), ttlMs, now)
    }

    public async Issue(principal: Principal): Promise<Session>
    {
        const token = randomBytes(FileSessionStore.TokenBytes).toString(FileSessionStore.TokenEncoding)
        const issuedAt = this.now()
        const expiresAt = new Date(issuedAt.getTime() + this.ttlMs)
        this.sessions.set(this.hash(token), { principalId: principal.Id, tenantId: principal.TenantId, issuedAt: issuedAt.toISOString(), expiresAt: expiresAt.toISOString() })
        await this.persist()
        return new Session(token, principal.Id, principal.TenantId, issuedAt, expiresAt, AuthMethod.Local)
    }

    public async Validate(token: string): Promise<Session | null>
    {
        const key = this.hash(token)
        const record = this.sessions.get(key)
        if (record === undefined)
        {
            return null
        }
        const session = new Session(token, record.principalId, record.tenantId, new Date(record.issuedAt), new Date(record.expiresAt), AuthMethod.Local)
        if (session.IsExpired(this.now()))
        {
            this.sessions.delete(key)
            await this.persist()
            return null
        }
        return session
    }

    public async Revoke(sessionId: string): Promise<void>
    {
        if (this.sessions.delete(this.hash(sessionId)))
        {
            await this.persist()
        }
    }

    private persist(): Promise<void>
    {
        return this.file.Write({ sessions: Object.fromEntries(this.sessions) } satisfies SessionDocument)
    }

    private hash(token: string): string
    {
        return createHash(FileSessionStore.HashAlgorithm).update(token).digest(FileSessionStore.HashEncoding)
    }
}
