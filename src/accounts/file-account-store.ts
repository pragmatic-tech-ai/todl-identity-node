import { LocalAccount, LocalAccountNotFoundError, LocalGroup, LocalGroupNotFoundError, Principal, PrincipalKind, SystemPrincipal } from '@pragmatic-tech-ai/todl-identity'
import type { ILocalAccountStore, ILocalGroupStore, IPrincipalDirectory, Realm } from '@pragmatic-tech-ai/todl-identity'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { JsonFile } from '../storage/json-file.js'
import { LegacyRealmNames } from '../storage/legacy-realm-names.js'

interface AccountRecord
{
    principalId: string
    realmId: string
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
    realmId: string
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
    private static readonly InvalidKeyComponentMessage = 'realm id and principal id must not contain the key separator'
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
            this.GroupsOrCreate(group.realmId).set(group.groupId, group)
        }
        for (const record of records)
        {
            this.byEmail.set(FileAccountStore.Key(record.realmId, record.email), record)
            this.byPrincipal.set(FileAccountStore.Key(record.realmId, record.principalId), record)
        }
    }

    public static async Open(storage: IStorage): Promise<FileAccountStore>
    {
        const file = new JsonFile(storage, FileAccountStore.FileName)
        const document = await file.Read<{ accounts: LegacyAccountRecord[], groups?: GroupRecord[] }>({ accounts: [] })
        LegacyRealmNames.UpgradeAll(document.accounts, LegacyRealmNames.LegacyRealmId, LegacyRealmNames.RealmId)
        LegacyRealmNames.UpgradeAll(document.groups, LegacyRealmNames.LegacyRealmId, LegacyRealmNames.RealmId)
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
        let group = groups.find(g => g.realmId === account.realmId && g.groupId === groupId)
        if (group === undefined)
        {
            group = { groupId, realmId: account.realmId, name: groupId, memberIds: [] }
            groups.push(group)
        }
        if (!group.memberIds.includes(account.principalId))
        {
            group.memberIds.push(account.principalId)
        }
    }

    public async CreateAccount(realm: Realm, email: string, principalId: string, secretRef: string): Promise<LocalAccount>
    {
        if (realm.Id.includes(FileAccountStore.KeySeparator) || principalId.includes(FileAccountStore.KeySeparator))
        {
            throw new Error(FileAccountStore.InvalidKeyComponentMessage)
        }
        if (SystemPrincipal.IsReserved(principalId))
        {
            throw new Error(FileAccountStore.ReservedPrincipalMessage)
        }
        const emailKey = FileAccountStore.Key(realm.Id, email)
        const principalKey = FileAccountStore.Key(realm.Id, principalId)
        if (this.byEmail.has(emailKey))
        {
            throw new Error(FileAccountStore.DuplicateEmailMessage)
        }
        if (this.byPrincipal.has(principalKey))
        {
            throw new Error(FileAccountStore.DuplicatePrincipalMessage)
        }
        const record: AccountRecord = { principalId, realmId: realm.Id, email, secretRef, disabled: false }
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
        return new LocalAccount(principalId, realm.Id, email, secretRef, false)
    }

    public async Disable(realm: Realm, principalId: string): Promise<void>
    {
        const record = this.byPrincipal.get(FileAccountStore.Key(realm.Id, principalId))
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

    public async Enable(realm: Realm, principalId: string): Promise<void>
    {
        const record = this.byPrincipal.get(FileAccountStore.Key(realm.Id, principalId))
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

    public async ListAccounts(realm: Realm): Promise<readonly LocalAccount[]>
    {
        const accounts: LocalAccount[] = []
        for (const record of this.byPrincipal.values())
        {
            if (record.realmId === realm.Id)
            {
                accounts.push(FileAccountStore.Map(record))
            }
        }
        return accounts
    }

    public async FindByEmail(realm: Realm, email: string): Promise<LocalAccount | null>
    {
        return FileAccountStore.ToAccount(this.byEmail.get(FileAccountStore.Key(realm.Id, email)))
    }

    public async FindByPrincipalId(realm: Realm, principalId: string): Promise<LocalAccount | null>
    {
        return FileAccountStore.ToAccount(this.byPrincipal.get(FileAccountStore.Key(realm.Id, principalId)))
    }

    public async Lookup(principalId: string, realm: Realm): Promise<Principal | null>
    {
        const record = this.byPrincipal.get(FileAccountStore.Key(realm.Id, principalId))
        if (record === undefined || record.disabled === true)
        {
            return null
        }
        return new Principal(principalId, realm.Id, PrincipalKind.User, new Map(), this.GroupIdsOf(realm.Id, principalId))
    }

    public async GroupsOf(principal: Principal): Promise<readonly string[]>
    {
        if (principal.Groups.length > 0)
        {
            return principal.Groups
        }
        return this.GroupIdsOf(principal.RealmId, principal.Id)
    }

    public async CreateGroup(realm: Realm, groupId: string, name: string): Promise<LocalGroup>
    {
        const realmGroups = this.GroupsOrCreate(realm.Id)
        if (realmGroups.has(groupId))
        {
            throw new Error(FileAccountStore.DuplicateGroupMessage)
        }
        const record: GroupRecord = { groupId, realmId: realm.Id, name, memberIds: [] }
        await this.Commit(realmGroups, groupId, record)
        return FileAccountStore.ToGroup(record)
    }

    public async DeleteGroup(realm: Realm, groupId: string): Promise<void>
    {
        const { realmGroups } = this.RequireGroup(realm, groupId)
        await this.Commit(realmGroups, groupId, undefined)
    }

    public async AddMember(realm: Realm, groupId: string, principalId: string): Promise<void>
    {
        const { realmGroups, group } = this.RequireGroup(realm, groupId)
        if (group.memberIds.includes(principalId))
        {
            return
        }
        await this.Commit(realmGroups, groupId, { ...group, memberIds: [...group.memberIds, principalId] })
    }

    public async RemoveMember(realm: Realm, groupId: string, principalId: string): Promise<void>
    {
        const { realmGroups, group } = this.RequireGroup(realm, groupId)
        await this.Commit(realmGroups, groupId, { ...group, memberIds: group.memberIds.filter(id => id !== principalId) })
    }

    public async ListGroups(realm: Realm): Promise<readonly LocalGroup[]>
    {
        return [...(this.FindGroups(realm.Id)?.values() ?? [])].map(FileAccountStore.ToGroup)
    }

    /** Applies one group change (set, or delete when the record is undefined) and persists; restores the previous value if the write fails. */
    private async Commit(realmGroups: Map<string, GroupRecord>, groupId: string, record: GroupRecord | undefined): Promise<void>
    {
        const previous = realmGroups.get(groupId)
        FileAccountStore.Apply(realmGroups, groupId, record)
        try
        {
            await this.persist()
        }
        catch (error)
        {
            FileAccountStore.Apply(realmGroups, groupId, previous)
            throw error
        }
    }

    private static Apply(realmGroups: Map<string, GroupRecord>, groupId: string, record: GroupRecord | undefined): void
    {
        if (record === undefined)
        {
            realmGroups.delete(groupId)
        }
        else
        {
            realmGroups.set(groupId, record)
        }
    }

    private RequireGroup(realm: Realm, groupId: string): { realmGroups: Map<string, GroupRecord>, group: GroupRecord }
    {
        const realmGroups = this.FindGroups(realm.Id)
        const group = realmGroups?.get(groupId)
        if (realmGroups === undefined || group === undefined)
        {
            throw new LocalGroupNotFoundError(groupId)
        }
        return { realmGroups, group }
    }

    private FindGroups(realmId: string): Map<string, GroupRecord> | undefined
    {
        return this.groups.get(realmId)
    }

    private GroupsOrCreate(realmId: string): Map<string, GroupRecord>
    {
        let realmGroups = this.groups.get(realmId)
        if (realmGroups === undefined)
        {
            realmGroups = new Map<string, GroupRecord>()
            this.groups.set(realmId, realmGroups)
        }
        return realmGroups
    }

    private GroupIdsOf(realmId: string, principalId: string): string[]
    {
        return [...(this.groups.get(realmId)?.values() ?? [])]
            .filter(group => group.memberIds.includes(principalId))
            .map(group => group.groupId)
    }

    private static ToGroup(record: GroupRecord): LocalGroup
    {
        return new LocalGroup(record.groupId, record.realmId, record.name, [...record.memberIds])
    }

    private persist(): Promise<void>
    {
        const accounts = [...this.byPrincipal.values()]
        const groups = [...this.groups.values()].flatMap(realmGroups => [...realmGroups.values()])
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
        return new LocalAccount(record.principalId, record.realmId, record.email, record.secretRef, record.disabled === true)
    }

    private static Key(realmId: string, id: string): string
    {
        return realmId + FileAccountStore.KeySeparator + id
    }
}
