import { DelegationDepth, ResourceAuthorizationPolicy } from '@pragmatic-tech-ai/todl-identity'
import type { AuthMethod, IAccessPolicy, IAuthenticator, IIdentityProviderPack, IPrincipalDirectory, ISessionManager, IRoleGrantStore, IAuditSink, ISecretStore, IServiceTokenStore, IdentityStoreSet } from '@pragmatic-tech-ai/todl-identity'
import { Argon2PasswordHasher, LocalAccountRegistrar, LocalPasswordAuthenticator, ServiceTokenAuthenticator } from '@pragmatic-tech-ai/todl-identity-local'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { FileIdentityStores } from './file-identity-stores.js'

export interface ServerIdentityPackComposition
{
    ExtraAuthenticators?: readonly IAuthenticator[]
    DelegationDepth?: DelegationDepth
    Policy?: IAccessPolicy
}

/** Persistent single-tenant identity pack built over an injected store-set (file-backed by default). */
export class ServerIdentityPack implements IIdentityProviderPack
{
    public readonly DelegationDepth: DelegationDepth
    public readonly Policy: IAccessPolicy
    public readonly Authenticators: readonly IAuthenticator[]
    public readonly Directory: IPrincipalDirectory
    public readonly Sessions: ISessionManager
    public readonly Grants: IRoleGrantStore
    public readonly Audit: IAuditSink
    public readonly Registrar: LocalAccountRegistrar
    public readonly Tokens: IServiceTokenStore
    public readonly Secrets: ISecretStore

    private constructor(stores: IdentityStoreSet, composition: ServerIdentityPackComposition)
    {
        const hasher = new Argon2PasswordHasher()
        this.Secrets = stores.Secrets
        this.Directory = stores.Accounts
        this.Tokens = stores.Tokens
        this.Sessions = stores.Sessions
        this.Grants = stores.Grants
        this.Audit = stores.Audit
        this.Registrar = new LocalAccountRegistrar(stores.Accounts, stores.Secrets, hasher, stores.Audit)
        const base: IAuthenticator[] = [new ServiceTokenAuthenticator(stores.Tokens), new LocalPasswordAuthenticator(stores.Accounts, stores.Secrets, hasher)]
        this.Authenticators = [...base, ...(composition.ExtraAuthenticators ?? [])]
        this.DelegationDepth = composition.DelegationDepth ?? DelegationDepth.FullAuthz
        this.Policy = composition.Policy ?? new ResourceAuthorizationPolicy()
    }

    public static async Open(storage: IStorage, masterKey: Buffer, oidcAuthenticator?: IAuthenticator): Promise<ServerIdentityPack>
    {
        return ServerIdentityPack.OpenWith(await FileIdentityStores.Open(storage, masterKey), oidcAuthenticator)
    }

    public static OpenWith(stores: IdentityStoreSet, oidcAuthenticator?: IAuthenticator): ServerIdentityPack
    public static OpenWith(stores: IdentityStoreSet, composition: ServerIdentityPackComposition): ServerIdentityPack
    public static OpenWith(stores: IdentityStoreSet, arg?: IAuthenticator | ServerIdentityPackComposition): ServerIdentityPack
    {
        return new ServerIdentityPack(stores, ServerIdentityPack.Normalize(arg))
    }

    public AuthenticatorFor(method: AuthMethod): IAuthenticator | undefined
    {
        return this.Authenticators.find(authenticator => authenticator.Method === method)
    }

    private static Normalize(arg?: IAuthenticator | ServerIdentityPackComposition): ServerIdentityPackComposition
    {
        if (arg === undefined)
        {
            return {}
        }
        if (ServerIdentityPack.IsAuthenticator(arg))
        {
            return { ExtraAuthenticators: [arg] }
        }
        return arg
    }

    private static IsAuthenticator(arg: IAuthenticator | ServerIdentityPackComposition): arg is IAuthenticator
    {
        return typeof (arg as IAuthenticator).Authenticate === 'function'
    }
}
