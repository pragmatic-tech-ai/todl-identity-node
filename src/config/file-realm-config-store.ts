import { DelegationDepth, IdentityConfig, Role, InvalidSecurityModelError, SecurityModelIssue, SecurityModelIssueCode, SecurityModelValidator } from '@pragmatic-tech-ai/todl-identity'
import type { IRealmConfigStore, ISecurityModelConfig } from '@pragmatic-tech-ai/todl-identity'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { InvalidRealmConfigError } from './invalid-realm-config-error.js'
import { JsonFile } from '../storage/json-file.js'
import { LegacyRealmNames } from '../storage/legacy-realm-names.js'
import { SecurityModelMigration } from './security-model-migration.js'

interface ConfigRecord
{
    packId: string
    delegationDepth: DelegationDepth
    providerSettings: Array<[string, string]>
    groupRoleMap: Array<[string, Role]>
    claimsMapping: Array<[string, string]>
    securityModel?: ISecurityModelConfig
}

interface ConfigDocument
{
    configs: Record<string, ConfigRecord>
}

export class FileRealmConfigStore implements IRealmConfigStore
{
    private static readonly SecurityModelPath = 'securityModel'
    private static readonly NotAnObjectMessage = 'stored security model is not an object'

    private readonly file: JsonFile
    private readonly configs: Map<string, ConfigRecord>
    private readonly invalid: Map<string, Error>
    /** Set while the configs still come from the legacy `tenant-config.json`; the first write removes that file. */
    private legacy: IStorage | undefined

    private constructor(file: JsonFile, configs: Map<string, ConfigRecord>, invalid: Map<string, Error>, legacy: IStorage | undefined)
    {
        this.file = file
        this.configs = configs
        this.invalid = invalid
        this.legacy = legacy
    }

    /** Reads `realm-config.json`; only when it does not exist yet, the legacy `tenant-config.json` (one release). */
    public static async Open(storage: IStorage): Promise<FileRealmConfigStore>
    {
        const L = LegacyRealmNames
        const file = new JsonFile(storage, L.ConfigFile)
        const legacy = !await storage.Exists(L.ConfigFile) && await storage.Exists(L.LegacyConfigFile) ? storage : undefined
        const source = legacy === undefined ? file : new JsonFile(storage, L.LegacyConfigFile)
        const document = await source.Read<ConfigDocument>({ configs: {} })
        const configs = new Map(Object.entries(document.configs ?? {}))
        const invalid = new Map<string, Error>()
        let changed = false
        for (const [realmId, record] of configs)
        {
            // One malformed record makes only its own realm unreadable; every other realm still opens.
            try
            {
                changed = FileRealmConfigStore.Load(realmId, record, invalid) || changed
            }
            catch
            {
                invalid.set(realmId, new InvalidRealmConfigError(realmId))
            }
        }
        const store = new FileRealmConfigStore(file, configs, invalid, legacy)
        if (changed)
        {
            await store.WriteDocument()
        }
        return store
    }

    /** Writes every config to `realm-config.json`; the first write after a legacy read also removes `tenant-config.json`. */
    private async WriteDocument(): Promise<void>
    {
        await this.file.Write({ configs: Object.fromEntries(this.configs) } satisfies ConfigDocument)
        if (this.legacy !== undefined)
        {
            await this.legacy.Delete(LegacyRealmNames.LegacyConfigFile)
            this.legacy = undefined
        }
    }

    // Returns true when the record's security model was upgraded in place.
    private static Load(realmId: string, record: ConfigRecord, invalid: Map<string, Error>): boolean
    {
        if (typeof record !== 'object' || record === null || Array.isArray(record))
        {
            invalid.set(realmId, new InvalidRealmConfigError(realmId))
            return false
        }
        if (!FileRealmConfigStore.HasWellFormedFields(record))
        {
            invalid.set(realmId, new InvalidRealmConfigError(realmId))
            return false
        }
        if (record.securityModel === undefined)
        {
            return false
        }
        if (typeof record.securityModel !== 'object' || record.securityModel === null || Array.isArray(record.securityModel))
        {
            invalid.set(realmId, FileRealmConfigStore.Malformed(FileRealmConfigStore.SecurityModelPath, FileRealmConfigStore.NotAnObjectMessage))
            return false
        }
        let changed = false
        if (SecurityModelMigration.NeedsUpgrade(record.securityModel as unknown as Readonly<Record<string, unknown>>))
        {
            record.securityModel = SecurityModelMigration.Upgrade(record.securityModel as unknown as Readonly<Record<string, unknown>>)
            changed = true
        }
        const issues = SecurityModelValidator.Validate(record.securityModel)
        if (issues.length > 0)
        {
            invalid.set(realmId, new InvalidSecurityModelError(issues))
        }
        return changed
    }

    private static HasWellFormedFields(record: ConfigRecord): boolean
    {
        return typeof record.packId === 'string'
            && FileRealmConfigStore.IsEnumValue(DelegationDepth, record.delegationDepth)
            && FileRealmConfigStore.IsPairs(record.providerSettings, v => typeof v === 'string')
            && FileRealmConfigStore.IsPairs(record.groupRoleMap, v => FileRealmConfigStore.IsEnumValue(Role, v))
            && FileRealmConfigStore.IsPairs(record.claimsMapping, v => typeof v === 'string')
    }

    /** Numeric enums carry reverse name mappings, so a bare Object.values check would accept the member names. */
    private static IsEnumValue(enumObject: Record<number, string>, value: unknown): boolean
    {
        return typeof value === 'number' && enumObject[value] !== undefined
    }

    private static IsPairs(value: unknown, isValue: (v: unknown) => boolean): boolean
    {
        return Array.isArray(value)
            && value.every(pair => Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && isValue(pair[1]))
    }

    private static Malformed(path: string, message: string): InvalidSecurityModelError
    {
        return new InvalidSecurityModelError([new SecurityModelIssue(SecurityModelIssueCode.MalformedSection, path, message)])
    }

    public async Get(realmId: string): Promise<IdentityConfig | null>
    {
        const record = this.configs.get(realmId)
        if (record === undefined)
        {
            return null
        }
        const error = this.invalid.get(realmId)
        if (error !== undefined)
        {
            throw error
        }
        return new IdentityConfig(record.packId, record.delegationDepth, new Map(record.providerSettings), new Map(record.groupRoleMap), new Map(record.claimsMapping), record.securityModel)
    }

    public async Save(realmId: string, config: IdentityConfig): Promise<void>
    {
        if (config.SecurityModel !== undefined)
        {
            SecurityModelValidator.AssertValid(config.SecurityModel)
        }
        const previous = this.configs.get(realmId)
        this.configs.set(realmId, { packId: config.PackId, delegationDepth: config.DelegationDepth, providerSettings: [...config.ProviderSettings], groupRoleMap: [...config.GroupRoleMap], claimsMapping: [...config.ClaimsMapping], securityModel: config.SecurityModel })
        try
        {
            await this.WriteDocument()
        }
        catch (error)
        {
            if (previous === undefined)
            {
                this.configs.delete(realmId)
            }
            else
            {
                this.configs.set(realmId, previous)
            }
            throw error
        }
        this.invalid.delete(realmId)
    }

    public async List(): Promise<readonly string[]>
    {
        return [...this.configs.keys()]
    }
}
