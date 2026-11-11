import { IdentityConfig, InvalidSecurityModelError, SecurityModelValidator } from '@pragmatic-tech-ai/todl-identity'
import type { DelegationDepth, Role, ITenantConfigStore, ISecurityModelConfig } from '@pragmatic-tech-ai/todl-identity'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
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

    private readonly file: JsonFile
    private readonly configs: Map<string, ConfigRecord>
    private readonly invalid: Map<string, InvalidSecurityModelError>

    private constructor(file: JsonFile, configs: Map<string, ConfigRecord>, invalid: Map<string, InvalidSecurityModelError>)
    {
        this.file = file
        this.configs = configs
        this.invalid = invalid
    }

    public static async Open(storage: IStorage): Promise<FileTenantConfigStore>
    {
        const file = new JsonFile(storage, FileTenantConfigStore.FileName)
        const document = await file.Read<ConfigDocument>({ configs: {} })
        const configs = new Map(Object.entries(document.configs))
        const invalid = new Map<string, InvalidSecurityModelError>()
        let changed = false
        for (const [tenantId, record] of configs)
        {
            if (record.securityModel === undefined)
            {
                continue
            }
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
        }
        if (changed)
        {
            await file.Write({ configs: Object.fromEntries(configs) } satisfies ConfigDocument)
        }
        return new FileTenantConfigStore(file, configs, invalid)
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
