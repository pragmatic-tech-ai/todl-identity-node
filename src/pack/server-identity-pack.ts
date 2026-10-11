import { DelegationDepth, ResourceAuthorizationPolicy } from '@pragmatic-tech-ai/todl-identity'
import type { AuthMethod, IAccessPolicy, IAuthenticator, IIdentityProviderPack, IPrincipalDirectory, ISessionManager, IRoleGrantStore, IAuditSink } from '@pragmatic-tech-ai/todl-identity'
import { Argon2PasswordHasher, LocalAccountRegistrar, LocalPasswordAuthenticator, ServiceTokenAuthenticator } from '@pragmatic-tech-ai/todl-identity-local'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { FileEncryptedSecretStore } from '../secrets/file-encrypted-secret-store.js'
import { FileAccountStore } from '../accounts/file-account-store.js'
import { FileServiceTokenStore } from '../tokens/file-service-token-store.js'
import { FileSessionStore } from '../sessions/file-session-store.js'
import { FileRoleGrantStore } from '../grants/file-role-grant-store.js'
import { FileAuditSink } from '../audit/file-audit-sink.js'

/** Persistent single-tenant identity pack: file-backed stores + argon2id + the built authenticators. */
export class ServerIdentityPack implements IIdentityProviderPack
{
    public readonly DelegationDepth = DelegationDepth.FullAuthz
    public readonly Policy: IAccessPolicy = new ResourceAuthorizationPolicy()
    public readonly Authenticators: readonly IAuthenticator[]
    public readonly Directory: IPrincipalDirectory
    public readonly Sessions: ISessionManager
    public readonly Grants: IRoleGrantStore
    public readonly Audit: IAuditSink
    public readonly Registrar: LocalAccountRegistrar
    public readonly Tokens: FileServiceTokenStore
    public readonly Secrets: FileEncryptedSecretStore

    private constructor(
        secrets: FileEncryptedSecretStore,
        accounts: FileAccountStore,
        tokens: FileServiceTokenStore,
        sessions: FileSessionStore,
        grants: FileRoleGrantStore,
        audit: FileAuditSink,
        oidcAuthenticator?: IAuthenticator)
    {
        const hasher = new Argon2PasswordHasher()
        this.Secrets = secrets
        this.Directory = accounts
        this.Tokens = tokens
        this.Sessions = sessions
        this.Grants = grants
        this.Audit = audit
        this.Registrar = new LocalAccountRegistrar(accounts, secrets, hasher, audit)
        const base: IAuthenticator[] = [new ServiceTokenAuthenticator(tokens), new LocalPasswordAuthenticator(accounts, secrets, hasher)]
        this.Authenticators = oidcAuthenticator === undefined ? base : [...base, oidcAuthenticator]
    }

    public static async Open(storage: IStorage, masterKey: Buffer, oidcAuthenticator?: IAuthenticator): Promise<ServerIdentityPack>
    {
        const secrets = await FileEncryptedSecretStore.Open(storage, masterKey)
        const accounts = await FileAccountStore.Open(storage)
        const tokens = await FileServiceTokenStore.Open(storage)
        const sessions = await FileSessionStore.Open(storage)
        const grants = await FileRoleGrantStore.Open(storage)
        const audit = await FileAuditSink.Open(storage)
        return new ServerIdentityPack(secrets, accounts, tokens, sessions, grants, audit, oidcAuthenticator)
    }

    public AuthenticatorFor(method: AuthMethod): IAuthenticator | undefined
    {
        return this.Authenticators.find(authenticator => authenticator.Method === method)
    }
}
