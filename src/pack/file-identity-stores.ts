import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import type { IdentityStoreSet } from '@pragmatic-tech-ai/todl-identity'
import { FileEncryptedSecretStore } from '../secrets/file-encrypted-secret-store.js'
import { FileAccountStore } from '../accounts/file-account-store.js'
import { FileServiceTokenStore } from '../tokens/file-service-token-store.js'
import { FileSessionStore } from '../sessions/file-session-store.js'
import { FileRoleGrantStore } from '../grants/file-role-grant-store.js'
import { FileAuditSink } from '../audit/file-audit-sink.js'

/** Builds the file-backed identity store set — the local/default platform's stores, opened over one IStorage. */
export class FileIdentityStores
{
    public static async Open(storage: IStorage, masterKey: Buffer): Promise<IdentityStoreSet>
    {
        const secrets = await FileEncryptedSecretStore.Open(storage, masterKey)
        const accounts = await FileAccountStore.Open(storage)
        const tokens = await FileServiceTokenStore.Open(storage)
        const sessions = await FileSessionStore.Open(storage)
        const grants = await FileRoleGrantStore.Open(storage)
        const audit = await FileAuditSink.Open(storage)
        return { Secrets: secrets, Accounts: accounts, Tokens: tokens, Sessions: sessions, Grants: grants, Audit: audit }
    }
}
