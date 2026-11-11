import { LocalAccount, LocalAccountNotFoundError, LocalGroup, LocalGroupNotFoundError, Principal, PrincipalKind, SystemPrincipal } from '@pragmatic-tech-ai/todl-identity'
import type { ILocalAccountStore, ILocalGroupStore, IPrincipalDirectory, Tenant } from '@pragmatic-tech-ai/todl-identity'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { JsonFile } from '../storage/json-file.js'

interface AccountRecord
{
    principalId: string
    tenantId: string
    email: string
    secretRef: string
    disabled?: boolean
}

interface LegacyAccountRecord extends AccountRecord
{
    groups?: readonly string[]
}

interface GroupRecord
{
    groupId: string
    tenantId: string
    name: string
    memberIds: string[]
}

interface AccountDocument
{
    accounts: AccountRecord[]
    groups: GroupRecord[]
}

export class FileAccountStore implements ILocalAccountStore, IPrincipalDirectory, ILocalGroupStore
{
    private static readonly FileName = 'accounts.json'
    private static readonly DuplicateEmailMessage = 'email already registered'
    private static readonly DuplicatePrincipalMessage = 'principal already registered'
    private static readonly InvalidKeyComponentMessage = 'tenant id and principal id must not contain the key separator'
    private static readonly ReservedPrincipalMessage = 'principal id uses the reserved system prefix'
    private static readonly DuplicateGroupMessage = 'group already exists'
    private static readonly KeySeparator = '/'

    private readonly file: JsonFile
    private readonly byEmail = new Map<string, AccountRecord>()
    private readonly byPrincipal = new Map<string, AccountRecord>()
    private readonly groups = new Map<string, Map<string, GroupRecord>>()

    private constructor(file: JsonFile, records: readonly AccountRecord[], groups: readonly GroupRecord[])
    {
        this.file = file
        for (const group of groups)
        {
            this.GroupsOrCreate(group.tenantId).set(group.groupId, group)
        }
        for (const record of records)
        {
            this.byEmail.set(FileAccountStore.Key(record.tenantId, record.email), record)
            this.byPrincipal.set(FileAccountStore.Key(record.tenantId, record.principalId), record)
        }
    }

    public static async Open(storage: IStorage): Promise<FileAccountStore>
    {
        const file = new JsonFile(storage, FileAccountStore.FileName)
        const document = await file.Read<{ accounts: LegacyAccountRecord[], groups?: GroupRecord[] }>({ accounts: [] })
        const groups = (document.groups ?? []).map(group => ({ ...group, memberIds: [...group.memberIds] }))
        let migrated = false
        const accounts: AccountRecord[] = []
        for (const { groups: legacy, ...record } of document.accounts)
        {
            if (legacy !== undefined)
            {
                migrated = true
                for (const groupId of legacy)
                {
                    FileAccountStore.JoinLegacyGroup(groups, record, groupId)
                }
            }
            accounts.push(record)
        }
        const store = new FileAccountStore(file, accounts, groups)
        if (migrated)
        {
            await store.persist()
        }
        return store
    }

    private static JoinLegacyGroup(groups: GroupRecord[], account: AccountRecord, groupId: string): void
    {
        let group = groups.find(g => g.tenantId === account.tenantId && g.groupId === groupId)
        if (group === undefined)
        {
            group = { groupId, tenantId: account.tenantId, name: groupId, memberIds: [] }
            groups.push(group)
        }
        if (!group.memberIds.includes(account.principalId))
        {
            group.memberIds.push(account.principalId)
        }
    }

    public async CreateAccount(tenant: Tenant, email: string, principalId: string, secretRef: string): Promise<LocalAccount>
    {
        if (tenant.Id.includes(FileAccountStore.KeySeparator) || principalId.includes(FileAccountStore.KeySeparator))
        {
            throw new Error(FileAccountStore.InvalidKeyComponentMessage)
        }
        if (SystemPrincipal.IsReserved(principalId))
        {
            throw new Error(FileAccountStore.ReservedPrincipalMessage)
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
        const record: AccountRecord = { principalId, tenantId: tenant.Id, email, secretRef, disabled: false }
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

    public async Enable(tenant: Tenant, principalId: string): Promise<void>
    {
        const record = this.byPrincipal.get(FileAccountStore.Key(tenant.Id, principalId))
        if (record === undefined)
        {
            throw new LocalAccountNotFoundError(principalId)
        }
        const previous = record.disabled
        record.disabled = false
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
        return new Principal(principalId, tenant.Id, PrincipalKind.User, new Map(), this.GroupIdsOf(tenant.Id, principalId))
    }

    public async GroupsOf(principal: Principal): Promise<readonly string[]>
    {
        if (principal.Groups.length > 0)
        {
            return principal.Groups
        }
        return this.GroupIdsOf(principal.TenantId, principal.Id)
    }

    public async CreateGroup(tenant: Tenant, groupId: string, name: string): Promise<LocalGroup>
    {
        const tenantGroups = this.GroupsOrCreate(tenant.Id)
        if (tenantGroups.has(groupId))
        {
            throw new Error(FileAccountStore.DuplicateGroupMessage)
        }
        const record: GroupRecord = { groupId, tenantId: tenant.Id, name, memberIds: [] }
        await this.Commit(tenantGroups, groupId, record)
        return FileAccountStore.ToGroup(record)
    }

    public async DeleteGroup(tenant: Tenant, groupId: string): Promise<void>
    {
        const { tenantGroups } = this.RequireGroup(tenant, groupId)
        await this.Commit(tenantGroups, groupId, undefined)
    }

    public async AddMember(tenant: Tenant, groupId: string, principalId: string): Promise<void>
    {
        const { tenantGroups, group } = this.RequireGroup(tenant, groupId)
        if (group.memberIds.includes(principalId))
        {
            return
        }
        await this.Commit(tenantGroups, groupId, { ...group, memberIds: [...group.memberIds, principalId] })
    }

    public async RemoveMember(tenant: Tenant, groupId: string, principalId: string): Promise<void>
    {
        const { tenantGroups, group } = this.RequireGroup(tenant, groupId)
        await this.Commit(tenantGroups, groupId, { ...group, memberIds: group.memberIds.filter(id => id !== principalId) })
    }

    public async ListGroups(tenant: Tenant): Promise<readonly LocalGroup[]>
    {
        return [...(this.FindGroups(tenant.Id)?.values() ?? [])].map(FileAccountStore.ToGroup)
    }

    /** Applies one group change (set, or delete when the record is undefined) and persists; restores the previous value if the write fails. */
    private async Commit(tenantGroups: Map<string, GroupRecord>, groupId: string, record: GroupRecord | undefined): Promise<void>
    {
        const previous = tenantGroups.get(groupId)
        FileAccountStore.Apply(tenantGroups, groupId, record)
        try
        {
            await this.persist()
        }
        catch (error)
        {
            FileAccountStore.Apply(tenantGroups, groupId, previous)
            throw error
        }
    }

    private static Apply(tenantGroups: Map<string, GroupRecord>, groupId: string, record: GroupRecord | undefined): void
    {
        if (record === undefined)
        {
            tenantGroups.delete(groupId)
        }
        else
        {
            tenantGroups.set(groupId, record)
        }
    }

    private RequireGroup(tenant: Tenant, groupId: string): { tenantGroups: Map<string, GroupRecord>, group: GroupRecord }
    {
        const tenantGroups = this.FindGroups(tenant.Id)
        const group = tenantGroups?.get(groupId)
        if (tenantGroups === undefined || group === undefined)
        {
            throw new LocalGroupNotFoundError(groupId)
        }
        return { tenantGroups, group }
    }

    private FindGroups(tenantId: string): Map<string, GroupRecord> | undefined
    {
        return this.groups.get(tenantId)
    }

    private GroupsOrCreate(tenantId: string): Map<string, GroupRecord>
    {
        let tenantGroups = this.groups.get(tenantId)
        if (tenantGroups === undefined)
        {
            tenantGroups = new Map<string, GroupRecord>()
            this.groups.set(tenantId, tenantGroups)
        }
        return tenantGroups
    }

    private GroupIdsOf(tenantId: string, principalId: string): string[]
    {
        return [...(this.groups.get(tenantId)?.values() ?? [])]
            .filter(group => group.memberIds.includes(principalId))
            .map(group => group.groupId)
    }

    private static ToGroup(record: GroupRecord): LocalGroup
    {
        return new LocalGroup(record.groupId, record.tenantId, record.name, [...record.memberIds])
    }

    private persist(): Promise<void>
    {
        const accounts = [...this.byPrincipal.values()]
        const groups = [...this.groups.values()].flatMap(tenantGroups => [...tenantGroups.values()])
        return this.file.Write({ accounts, groups } satisfies AccountDocument)
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
