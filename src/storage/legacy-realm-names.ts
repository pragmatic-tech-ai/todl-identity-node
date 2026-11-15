/**
 * Reads identity files written before the Tenant -> Realm rename (compatibility). Each store maps every record through
 * Upgrade when it opens and, when anything was renamed, writes its file back at once, so the file on disk carries only
 * the current names from then on. When a record carries both names, the current one wins.
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

    /** Moves `legacy` to `current` on `record` (in place) unless `current` is already set; drops `legacy` either way.
     *  Answers true when the record carried the legacy name (so its file must be rewritten). */
    public static Upgrade(record: unknown, legacy: string, current: string): boolean
    {
        if (typeof record !== 'object' || record === null)
        {
            return false
        }
        const fields = record as Record<string, unknown>
        if (!Object.prototype.hasOwnProperty.call(fields, legacy))
        {
            return false
        }
        if (fields[current] === undefined)
        {
            fields[current] = fields[legacy]
        }
        delete fields[legacy]
        return true
    }

    /** Upgrade over every element of `records` (a missing list stays missing); true when any record changed. */
    public static UpgradeAll(records: readonly unknown[] | undefined, legacy: string, current: string): boolean
    {
        let changed = false
        for (const record of records ?? [])
        {
            changed = LegacyRealmNames.Upgrade(record, legacy, current) || changed
        }
        return changed
    }

    /** Upgrade over every value of a keyed map of records; true when any record changed. */
    public static UpgradeValues(records: Readonly<Record<string, unknown>> | undefined, legacy: string, current: string): boolean
    {
        return LegacyRealmNames.UpgradeAll(Object.values(records ?? {}), legacy, current)
    }
}
