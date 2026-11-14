/** A stored realm config record (or one of its fields) is malformed. Carries only the realm id; never any stored value. */
export class InvalidRealmConfigError extends Error
{
    private static readonly Message = 'stored realm config record is malformed'

    public constructor(public readonly RealmId: string)
    {
        super(InvalidRealmConfigError.Message)
        this.name = new.target.name
    }
}
