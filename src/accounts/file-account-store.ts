import { LocalAccount, LocalAccountNotFoundError, Principal, PrincipalKind } from '@pragmatic-tech-ai/todl-identity'
import type { ILocalAccountStore, IPrincipalDirectory, Tenant } from '@pragmatic-tech-ai/todl-identity'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { JsonFile } from '../storage/json-file.js'

interface AccountRecord
{
    principalId: string
    tenantId: string
    email: string
    secretRef: string
    groups: readonly string[]
    disabled?: boolean
}

interface AccountDocument
{
    accounts: AccountRecord[]
}

export class FileAccountStore implements ILocalAccountStore, IPrincipalDirectory
{
    private static readonly FileName = 'accounts.json'
    private static readonly DuplicateEmailMessage = 'email already registered'
    private static readonly DuplicatePrincipalMessage = 'principal already registered'
    private static readonly InvalidKeyComponentMessage = 'tenant id and principal id must not contain the key separator'
    private static readonly KeySeparator = '/'

    private readonly file: JsonFile
    private readonly byEmail = new Map<string, AccountRecord>()
    private readonly byPrincipal = new Map<string, AccountRecord>()

    private constructor(file: JsonFile, records: readonly AccountRecord[])
    {
        this.file = file
        for (const record of records)
        {
            this.byEmail.set(FileAccountStore.Key(record.tenantId, record.email), record)
            this.byPrincipal.set(FileAccountStore.Key(record.tenantId, record.principalId), record)
        }
    }

    public static async Open(storage: IStorage): Promise<FileAccountStore>
    {
        const file = new JsonFile(storage, FileAccountStore.FileName)
        const document = await file.Read<AccountDocument>({ accounts: [] })
        return new FileAccountStore(file, document.accounts)
    }

    public async CreateAccount(tenant: Tenant, email: string, principalId: string, secretRef: string): Promise<LocalAccount>
    {
        if (tenant.Id.includes(FileAccountStore.KeySeparator) || principalId.includes(FileAccountStore.KeySeparator))
        {
            throw new Error(FileAccountStore.InvalidKeyComponentMessage)
        }
        const emailKey = FileAccountStore.Key(tenant.Id, email)
        const principalKey = FileAccountStore.Key(tenant.Id, principalId)
        if (this.byEmail.has(emailKey))
        {
            throw new Error(FileAccountStore.DuplicateEmailMessage)
        }
        if (this.byPrincipal.has(principalKey))
        {
            throw new Error(FileAccountStore.DuplicatePrincipalMessage)
        }
        const record: AccountRecord = { principalId, tenantId: tenant.Id, email, secretRef, groups: [], disabled: false }
        this.byEmail.set(emailKey, record)
        this.byPrincipal.set(principalKey, record)
        try
        {
            await this.persist()
        }
        catch (error)
        {
            this.byEmail.delete(emailKey)
            this.byPrincipal.delete(principalKey)
            throw error
        }
        return new LocalAccount(principalId, tenant.Id, email, secretRef, false)
    }

    public async Disable(tenant: Tenant, principalId: string): Promise<void>
    {
        const record = this.byPrincipal.get(FileAccountStore.Key(tenant.Id, principalId))
        if (record === undefined)
        {
            throw new LocalAccountNotFoundError(principalId)
        }
        const previous = record.disabled
        record.disabled = true
        try
        {
            await this.persist()
        }
        catch (error)
        {
            record.disabled = previous
            throw error
        }
    }

    public async ListAccounts(tenant: Tenant): Promise<readonly LocalAccount[]>
    {
        const accounts: LocalAccount[] = []
        for (const record of this.byPrincipal.values())
        {
            if (record.tenantId === tenant.Id)
            {
                accounts.push(FileAccountStore.Map(record))
            }
        }
        return accounts
    }

    public async FindByEmail(tenant: Tenant, email: string): Promise<LocalAccount | null>
    {
        return FileAccountStore.ToAccount(this.byEmail.get(FileAccountStore.Key(tenant.Id, email)))
    }

    public async FindByPrincipalId(tenant: Tenant, principalId: string): Promise<LocalAccount | null>
    {
        return FileAccountStore.ToAccount(this.byPrincipal.get(FileAccountStore.Key(tenant.Id, principalId)))
    }

    public async Lookup(principalId: string, tenant: Tenant): Promise<Principal | null>
    {
        const record = this.byPrincipal.get(FileAccountStore.Key(tenant.Id, principalId))
        if (record === undefined || record.disabled === true)
        {
            return null
        }
        return new Principal(principalId, tenant.Id, PrincipalKind.User, new Map(), record.groups)
    }

    public async GroupsOf(principal: Principal): Promise<readonly string[]>
    {
        if (principal.Groups.length > 0)
        {
            return principal.Groups
        }
        return this.byPrincipal.get(FileAccountStore.Key(principal.TenantId, principal.Id))?.groups ?? []
    }

    private persist(): Promise<void>
    {
        const accounts = [...this.byPrincipal.values()]
        return this.file.Write({ accounts } satisfies AccountDocument)
    }

    private static ToAccount(record: AccountRecord | undefined): LocalAccount | null
    {
        if (record === undefined)
        {
            return null
        }
        return FileAccountStore.Map(record)
    }

    private static Map(record: AccountRecord): LocalAccount
    {
        return new LocalAccount(record.principalId, record.tenantId, record.email, record.secretRef, record.disabled === true)
    }

    private static Key(tenantId: string, id: string): string
    {
        return tenantId + FileAccountStore.KeySeparator + id
    }
}
