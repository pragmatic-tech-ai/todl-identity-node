import { DelegationDepth, IdentityConfig, Role, InvalidSecurityModelError, SecurityModelIssue, SecurityModelIssueCode, SecurityModelValidator } from '@pragmatic-tech-ai/todl-identity'
import type { ITenantConfigStore, ISecurityModelConfig } from '@pragmatic-tech-ai/todl-identity'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { InvalidTenantConfigError } from './invalid-tenant-config-error.js'
import { JsonFile } from '../storage/json-file.js'
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

export class FileTenantConfigStore implements ITenantConfigStore
{
    private static readonly FileName = 'tenant-config.json'
    private static readonly SecurityModelPath = 'securityModel'
    private static readonly NotAnObjectMessage = 'stored security model is not an object'

    private readonly file: JsonFile
    private readonly configs: Map<string, ConfigRecord>
    private readonly invalid: Map<string, Error>

    private constructor(file: JsonFile, configs: Map<string, ConfigRecord>, invalid: Map<string, Error>)
    {
        this.file = file
        this.configs = configs
        this.invalid = invalid
    }

    public static async Open(storage: IStorage): Promise<FileTenantConfigStore>
    {
        const file = new JsonFile(storage, FileTenantConfigStore.FileName)
        const document = await file.Read<ConfigDocument>({ configs: {} })
        const configs = new Map(Object.entries(document.configs ?? {}))
        const invalid = new Map<string, Error>()
        let changed = false
        for (const [tenantId, record] of configs)
        {
            // One malformed record makes only its own tenant unreadable; every other tenant still opens.
            try
            {
                changed = FileTenantConfigStore.Load(tenantId, record, invalid) || changed
            }
            catch
            {
                invalid.set(tenantId, new InvalidTenantConfigError(tenantId))
            }
        }
        if (changed)
        {
            await file.Write({ configs: Object.fromEntries(configs) } satisfies ConfigDocument)
        }
        return new FileTenantConfigStore(file, configs, invalid)
    }

    // Returns true when the record's security model was upgraded in place.
    private static Load(tenantId: string, record: ConfigRecord, invalid: Map<string, Error>): boolean
    {
        if (typeof record !== 'object' || record === null || Array.isArray(record))
        {
            invalid.set(tenantId, new InvalidTenantConfigError(tenantId))
            return false
        }
        if (!FileTenantConfigStore.HasWellFormedFields(record))
        {
            invalid.set(tenantId, new InvalidTenantConfigError(tenantId))
            return false
        }
        if (record.securityModel === undefined)
        {
            return false
        }
        if (typeof record.securityModel !== 'object' || record.securityModel === null || Array.isArray(record.securityModel))
        {
            invalid.set(tenantId, FileTenantConfigStore.Malformed(FileTenantConfigStore.SecurityModelPath, FileTenantConfigStore.NotAnObjectMessage))
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
            invalid.set(tenantId, new InvalidSecurityModelError(issues))
        }
        return changed
    }

    private static HasWellFormedFields(record: ConfigRecord): boolean
    {
        return typeof record.packId === 'string'
            && FileTenantConfigStore.IsEnumValue(DelegationDepth, record.delegationDepth)
            && FileTenantConfigStore.IsPairs(record.providerSettings, v => typeof v === 'string')
            && FileTenantConfigStore.IsPairs(record.groupRoleMap, v => FileTenantConfigStore.IsEnumValue(Role, v))
            && FileTenantConfigStore.IsPairs(record.claimsMapping, v => typeof v === 'string')
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

    public async Get(tenantId: string): Promise<IdentityConfig | null>
    {
        const record = this.configs.get(tenantId)
        if (record === undefined)
        {
            return null
        }
        const error = this.invalid.get(tenantId)
        if (error !== undefined)
        {
            throw error
        }
        return new IdentityConfig(record.packId, record.delegationDepth, new Map(record.providerSettings), new Map(record.groupRoleMap), new Map(record.claimsMapping), record.securityModel)
    }

    public async Save(tenantId: string, config: IdentityConfig): Promise<void>
    {
        if (config.SecurityModel !== undefined)
        {
            SecurityModelValidator.AssertValid(config.SecurityModel)
        }
        const previous = this.configs.get(tenantId)
        this.configs.set(tenantId, { packId: config.PackId, delegationDepth: config.DelegationDepth, providerSettings: [...config.ProviderSettings], groupRoleMap: [...config.GroupRoleMap], claimsMapping: [...config.ClaimsMapping], securityModel: config.SecurityModel })
        try
        {
            await this.file.Write({ configs: Object.fromEntries(this.configs) } satisfies ConfigDocument)
        }
        catch (error)
        {
            if (previous === undefined)
            {
                this.configs.delete(tenantId)
            }
            else
            {
                this.configs.set(tenantId, previous)
            }
            throw error
        }
        this.invalid.delete(tenantId)
    }

    public async List(): Promise<readonly string[]>
    {
        return [...this.configs.keys()]
    }
}
