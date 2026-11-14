import type { IBusinessUnitConfig, ISecurityModelConfig, ITeamConfig, IUserPlacementConfig } from '@pragmatic-tech-ai/todl-identity'

type RawRecord = Readonly<Record<string, unknown>>

/** One-shot upgrade of a stored pre-C5 security model to the C5 shape. Runs once per stored record when the
 *  realm config file is opened; the upgraded record is rewritten and nothing at runtime reads the old shape. */
export class SecurityModelMigration
{
    private static readonly OwnershipRulesKey = 'ownershipRules'
    private static readonly RolesKey = 'roles'
    private static readonly RoleAssignmentKey = 'roleAssignment'
    private static readonly FieldSecurityKey = 'fieldSecurity'
    private static readonly MembershipKey = 'membership'
    private static readonly ClaimsMappingKey = 'claimsMapping'
    private static readonly OverridesKey = 'overrides'
    private static readonly BusinessUnitsKey = 'businessUnits'
    private static readonly TeamsKey = 'teams'
    private static readonly ClaimKey = 'claim'
    private static readonly ValueKey = 'value'
    private static readonly PrincipalIdKey = 'principalId'
    private static readonly HomeBusinessUnitKey = 'homeBusinessUnit'
    private static readonly OwningBusinessUnitKey = 'owningBusinessUnit'
    private static readonly GroupClaim = 'group'
    private static readonly RetiredSections: readonly string[] = [
        SecurityModelMigration.OwnershipRulesKey,
        SecurityModelMigration.RolesKey,
        SecurityModelMigration.RoleAssignmentKey,
        SecurityModelMigration.FieldSecurityKey,
        SecurityModelMigration.MembershipKey,
    ]

    public static NeedsUpgrade(raw: Readonly<Record<string, unknown>>): boolean
    {
        if (SecurityModelMigration.RetiredSections.some(key => key in raw))
        {
            return true
        }
        return SecurityModelMigration.List(raw[SecurityModelMigration.TeamsKey]).some(team => SecurityModelMigration.OwningBusinessUnitKey in team)
    }

    public static Upgrade(raw: Readonly<Record<string, unknown>>): ISecurityModelConfig
    {
        const businessUnits = SecurityModelMigration.List(raw[SecurityModelMigration.BusinessUnitsKey]) as unknown as IBusinessUnitConfig[]
        const rootId = businessUnits.find(unit => unit.parent === undefined)?.id ?? ''
        const membership = (raw[SecurityModelMigration.MembershipKey] ?? {}) as RawRecord
        const rules = SecurityModelMigration.List(membership[SecurityModelMigration.ClaimsMappingKey])
        const overrides = SecurityModelMigration.List(membership[SecurityModelMigration.OverridesKey])
        const teams: ITeamConfig[] = SecurityModelMigration.List(raw[SecurityModelMigration.TeamsKey]).map(team =>
        {
            const id = team.id as string
            return {
                id,
                name: team.name as string,
                businessUnitId: (team[SecurityModelMigration.OwningBusinessUnitKey] as string | undefined) ?? (team.businessUnitId as string | undefined) ?? rootId,
                idpGroups: SecurityModelMigration.Distinct(rules
                    .filter(rule => rule[SecurityModelMigration.ClaimKey] === SecurityModelMigration.GroupClaim && SecurityModelMigration.Includes(rule.teams, id))
                    .map(rule => rule[SecurityModelMigration.ValueKey] as string)),
                manualMembers: SecurityModelMigration.Distinct(overrides
                    .filter(entry => SecurityModelMigration.Includes(entry.teams, id))
                    .map(entry => entry[SecurityModelMigration.PrincipalIdKey] as string)),
            }
        })
        const users: IUserPlacementConfig[] = overrides
            .filter(entry => typeof entry[SecurityModelMigration.HomeBusinessUnitKey] === 'string')
            .map(entry => ({ principalId: entry[SecurityModelMigration.PrincipalIdKey] as string, businessUnitId: entry[SecurityModelMigration.HomeBusinessUnitKey] as string }))
        return { businessUnits, users, teams, roleAssignments: [], profileAssignments: [], roleOverrides: [], profileOverrides: [] }
    }

    private static List(value: unknown): RawRecord[]
    {
        return Array.isArray(value) ? value as RawRecord[] : []
    }

    private static Includes(list: unknown, id: string): boolean
    {
        return Array.isArray(list) && list.includes(id)
    }

    private static Distinct(values: readonly string[]): string[]
    {
        return [...new Set(values)]
    }
}
