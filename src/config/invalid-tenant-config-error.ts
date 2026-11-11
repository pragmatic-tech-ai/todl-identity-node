/** A stored tenant config record (or one of its fields) is malformed. Carries only the tenant id; never any stored value. */
export class InvalidTenantConfigError extends Error
{
    private static readonly Message = 'stored tenant config record is malformed'

    public constructor(public readonly TenantId: string)
    {
        super(InvalidTenantConfigError.Message)
        this.name = new.target.name
    }
}
