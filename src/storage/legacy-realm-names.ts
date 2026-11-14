/**
 * Reads identity files written before the Tenant -> Realm rename (one-release compatibility). Each store maps every
 * record through Upgrade when it opens; the record then carries only the current name, so the store's next write
 * stores the new name. When a record carries both names, the current one wins.
 */
export class LegacyRealmNames
{
    /** `tenantId` -> `realmId` (accounts, groups, sessions, service tokens, audit events, audit checkpoints). */
    public static readonly RealmId = 'realmId'
    public static readonly LegacyRealmId = 'tenantId'
    /** `resourceTenantId` -> `resourceRealmId` (grants). */
    public static readonly ResourceRealmId = 'resourceRealmId'
    public static readonly LegacyResourceRealmId = 'resourceTenantId'
    /** Root key `tenants` -> `realms` (IdP directory snapshots). */
    public static readonly Realms = 'realms'
    public static readonly LegacyRealms = 'tenants'
    /** `tenant-config.json` -> `realm-config.json`. */
    public static readonly ConfigFile = 'realm-config.json'
    public static readonly LegacyConfigFile = 'tenant-config.json'

    private constructor()
    {
    }

    /** Moves `legacy` to `current` on `record` (in place) unless `current` is already set; drops `legacy` either way. */
    public static Upgrade<T>(record: T, legacy: string, current: string): T
    {
        if (typeof record !== 'object' || record === null)
        {
            return record
        }
        const fields = record as Record<string, unknown>
        if (Object.prototype.hasOwnProperty.call(fields, legacy))
        {
            if (fields[current] === undefined)
            {
                fields[current] = fields[legacy]
            }
            delete fields[legacy]
        }
        return record
    }

    /** Upgrade over every element of `records` (a missing list stays missing). */
    public static UpgradeAll<T>(records: T[] | undefined, legacy: string, current: string): T[] | undefined
    {
        records?.forEach(record => LegacyRealmNames.Upgrade(record, legacy, current))
        return records
    }

    /** Upgrade over every value of a keyed map of records. */
    public static UpgradeValues<T>(records: Record<string, T> | undefined, legacy: string, current: string): Record<string, T> | undefined
    {
        for (const record of Object.values(records ?? {}))
        {
            LegacyRealmNames.Upgrade(record, legacy, current)
        }
        return records
    }
}
