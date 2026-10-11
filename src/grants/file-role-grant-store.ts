import { Grant, Role, ResourceRef, ResourceKind } from '@pragmatic-tech-ai/todl-identity'
import type { IRoleGrantStore, Tenant } from '@pragmatic-tech-ai/todl-identity'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { JsonFile } from '../storage/json-file.js'

interface GrantRecord
{
    subject: string
    role: Role
    resourceKind: ResourceKind
    resourceTenantId: string
    resourcePath: string[]
}

interface GrantDocument
{
    grants: GrantRecord[]
}

export class FileRoleGrantStore implements IRoleGrantStore
{
    private static readonly FileName = 'grants.json'

    private readonly file: JsonFile
    private readonly grants: GrantRecord[]

    private constructor(file: JsonFile, grants: GrantRecord[])
    {
        this.file = file
        this.grants = grants
    }

    public static async Open(storage: IStorage): Promise<FileRoleGrantStore>
    {
        const file = new JsonFile(storage, FileRoleGrantStore.FileName)
        const document = await file.Read<GrantDocument>({ grants: [] })
        return new FileRoleGrantStore(file, document.grants)
    }

    public async GrantsFor(subject: string, _tenant: Tenant): Promise<readonly Grant[]>
    {
        return this.grants.filter(record => record.subject === subject).map(FileRoleGrantStore.ToGrant)
    }

    public async Save(grant: Grant): Promise<void>
    {
        this.grants.push({ subject: grant.Subject, role: grant.Role, resourceKind: grant.Resource.Kind, resourceTenantId: grant.Resource.TenantId, resourcePath: [...grant.Resource.Path] })
        await this.file.Write({ grants: this.grants } satisfies GrantDocument)
    }

    private static ToGrant(record: GrantRecord): Grant
    {
        return new Grant(record.subject, record.role, new ResourceRef(record.resourceKind, record.resourceTenantId, [...record.resourcePath]))
    }
}
