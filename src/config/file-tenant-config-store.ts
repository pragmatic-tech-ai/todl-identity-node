import { IdentityConfig } from '@pragmatic-tech-ai/todl-identity'
import type { DelegationDepth, Role, ITenantConfigStore, ISecurityModelConfig } from '@pragmatic-tech-ai/todl-identity'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { JsonFile } from '../storage/json-file.js'

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

    private constructor(file: JsonFile, configs: Map<string, ConfigRecord>)
    {
        this.file = file
        this.configs = configs
    }

    public static async Open(storage: IStorage): Promise<FileTenantConfigStore>
    {
        const file = new JsonFile(storage, FileTenantConfigStore.FileName)
        const document = await file.Read<ConfigDocument>({ configs: {} })
        return new FileTenantConfigStore(file, new Map(Object.entries(document.configs)))
    }

    public async Get(tenantId: string): Promise<IdentityConfig | null>
    {
        const record = this.configs.get(tenantId)
        if (record === undefined)
        {
            return null
        }
        return new IdentityConfig(record.packId, record.delegationDepth, new Map(record.providerSettings), new Map(record.groupRoleMap), new Map(record.claimsMapping), record.securityModel)
    }

    public async Save(tenantId: string, config: IdentityConfig): Promise<void>
    {
        this.configs.set(tenantId, { packId: config.PackId, delegationDepth: config.DelegationDepth, providerSettings: [...config.ProviderSettings], groupRoleMap: [...config.GroupRoleMap], claimsMapping: [...config.ClaimsMapping], securityModel: config.SecurityModel })
        await this.file.Write({ configs: Object.fromEntries(this.configs) } satisfies ConfigDocument)
    }

    public async List(): Promise<readonly string[]>
    {
        return [...this.configs.keys()]
    }
}
