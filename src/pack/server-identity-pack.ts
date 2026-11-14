import { DelegationDepth, ResourceAuthorizationPolicy } from '@pragmatic-tech-ai/todl-identity'
import type { AuthMethod, IAccessPolicy, IAuthenticator, IIdentityProviderPack, ILocalAccountStore, IPrincipalDirectory, ISessionManager, IRoleGrantStore, IAuditSink, ISecretStore, IServiceTokenStore, IdentityStoreSet, IIdpDirectorySource, ISourceTokenProvider, ILocalGroupStore, IIdpDirectoryStore } from '@pragmatic-tech-ai/todl-identity'
import { Argon2PasswordHasher, LocalAccountRegistrar, LocalDirectorySource, LocalPasswordAuthenticator, LocalSourceTokenProvider, ServiceTokenAuthenticator } from '@pragmatic-tech-ai/todl-identity-local'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { MixedDirectorySource } from '../directory/mixed-directory-source.js'
import { FileIdentityStores } from './file-identity-stores.js'

/** Optional per-pack composition: extra authenticators appended after token+local, delegation depth, and access policy. */
export interface ServerIdentityPackComposition
{
    ExtraAuthenticators?: readonly IAuthenticator[]
    DelegationDepth?: DelegationDepth
    Policy?: IAccessPolicy
    DirectorySource?: IIdpDirectorySource
    SourceTokens?: ISourceTokenProvider
}

/** Persistent single-realm identity pack built over an injected store-set (file-backed by default). */
export class ServerIdentityPack implements IIdentityProviderPack
{
    public readonly DelegationDepth: DelegationDepth
    public readonly Policy: IAccessPolicy
    public readonly Authenticators: readonly IAuthenticator[]
    public readonly Directory: IPrincipalDirectory
    public readonly Accounts: ILocalAccountStore
    public readonly Sessions: ISessionManager
    public readonly Grants: IRoleGrantStore
    public readonly Audit: IAuditSink
    public readonly Registrar: LocalAccountRegistrar
    public readonly Tokens: IServiceTokenStore
    public readonly Secrets: ISecretStore
    public readonly Groups: ILocalGroupStore
    public readonly IdpDirectory: IIdpDirectoryStore
    public readonly DirectorySource: IIdpDirectorySource
    public readonly SourceTokens: ISourceTokenProvider

    private constructor(stores: IdentityStoreSet, composition: ServerIdentityPackComposition)
    {
        const hasher = new Argon2PasswordHasher()
        this.Secrets = stores.Secrets
        this.Directory = stores.Accounts
        this.Accounts = stores.Accounts
        this.Groups = stores.Accounts
        this.IdpDirectory = stores.IdpDirectory
        this.DirectorySource = composition.DirectorySource ?? ServerIdentityPack.DefaultDirectorySource(stores, composition)
        this.SourceTokens = composition.SourceTokens ?? new LocalSourceTokenProvider(stores.Accounts, stores.Secrets)
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

    /** The local-only pack is its own authority; with external authenticators and no connector the directory is non-authoritative but still reports local account states. */
    private static DefaultDirectorySource(stores: IdentityStoreSet, composition: ServerIdentityPackComposition): IIdpDirectorySource
    {
        if ((composition.ExtraAuthenticators ?? []).length > 0)
        {
            return new MixedDirectorySource(stores.Accounts)
        }
        return new LocalDirectorySource(stores.Accounts, stores.Accounts)
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
