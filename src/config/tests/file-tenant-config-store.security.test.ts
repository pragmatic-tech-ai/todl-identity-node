import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IdentityConfig, DelegationDepth, InvalidSecurityModelError } from '@pragmatic-tech-ai/todl-identity'
import type { ISecurityModelConfig } from '@pragmatic-tech-ai/todl-identity'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { FileTenantConfigStore } from '../file-tenant-config-store.js'
import { JsonFile } from '../../storage/json-file.js'
import { SecurityModelMigration } from '../security-model-migration.js'

class Fixture
{
    public static SecurityModel(): ISecurityModelConfig
    {
        return {
            businessUnits: [{ id: 'root', name: 'Root' }, { id: 'eng', name: 'Eng', parent: 'root' }],
            users: [{ principalId: 'u1', businessUnitId: 'eng' }],
            teams: [{ id: 't-web', name: 'Web', businessUnitId: 'eng', idpGroups: ['web'], manualMembers: ['u1'] }],
            roleAssignments: [{ role: 'Reader', principalIds: ['u1'], teamIds: ['t-web'] }],
            profileAssignments: [],
            roleOverrides: [],
            profileOverrides: [],
        }
    }

    public static ConfigWith(model: ISecurityModelConfig | undefined): IdentityConfig
    {
        return new IdentityConfig('server-pack', DelegationDepth.FullAuthz, new Map(), new Map(), new Map(), model)
    }

    public static LegacyRecord(): Record<string, unknown>
    {
        return {
            packId: 'server-pack',
            delegationDepth: DelegationDepth.FullAuthz,
            providerSettings: [],
            groupRoleMap: [],
            claimsMapping: [],
            securityModel: {
                businessUnits: [{ id: 'hr', name: 'HR' }],
                teams: [{ id: 'hr', name: 'HR team', owningBusinessUnit: 'hr' }],
                membership: {
                    claimsMapping: [{ claim: 'group', value: 'hr-staff', teams: ['hr'] }],
                    overrides: [{ principalId: 'dana', homeBusinessUnit: 'hr', teams: ['hr'] }],
                },
                ownershipRules: [],
                fieldSecurity: [],
            },
        }
    }
}

test('a C5 SecurityModel round-trips through Save/Get and a reopen', async () =>
{
    const storage = new FakeStorage()
    const store = await FileTenantConfigStore.Open(storage)
    await store.Save('t1', Fixture.ConfigWith(Fixture.SecurityModel()))

    const reopened = await FileTenantConfigStore.Open(storage)
    assert.deepEqual((await reopened.Get('t1'))?.SecurityModel, Fixture.SecurityModel())
})

test('Save rejects an invalid model and writes nothing', async () =>
{
    const storage = new FakeStorage()
    const store = await FileTenantConfigStore.Open(storage)
    await store.Save('t1', Fixture.ConfigWith(Fixture.SecurityModel()))
    const bad: ISecurityModelConfig = { ...Fixture.SecurityModel(), teams: [{ id: 'x', name: 'X', businessUnitId: 'nowhere', idpGroups: [], manualMembers: [] }] }
    await assert.rejects(store.Save('t1', Fixture.ConfigWith(bad)), InvalidSecurityModelError)

    const reopened = await FileTenantConfigStore.Open(storage)
    assert.deepEqual((await reopened.Get('t1'))?.SecurityModel, Fixture.SecurityModel())
})

test('a legacy record is migrated on open and rewritten once', async () =>
{
    const storage = new FakeStorage()
    await new JsonFile(storage, 'tenant-config.json').Write({ configs: { t1: Fixture.LegacyRecord() } })
    const store = await FileTenantConfigStore.Open(storage)
    const model = (await store.Get('t1'))?.SecurityModel
    assert.deepEqual(model?.teams, [{ id: 'hr', name: 'HR team', businessUnitId: 'hr', idpGroups: ['hr-staff'], manualMembers: ['dana'] }])
    assert.deepEqual(model?.users, [{ principalId: 'dana', businessUnitId: 'hr' }])

    const raw = JSON.parse(await storage.ReadText('tenant-config.json')) as { configs: Record<string, { securityModel: Record<string, unknown> }> }
    const keys = Object.keys(raw.configs.t1.securityModel)
    for (const retired of ['ownershipRules', 'fieldSecurity', 'membership', 'roles', 'roleAssignment'])
    {
        assert.equal(keys.includes(retired), false)
    }
    assert.equal(SecurityModelMigration.NeedsUpgrade(raw.configs.t1.securityModel), false)
})

test('a null stored securityModel is invalid for that tenant only and does not crash Open', async () =>
{
    const storage = new FakeStorage()
    const bad = { ...Fixture.LegacyRecord(), securityModel: null }
    await new JsonFile(storage, 'tenant-config.json').Write({ configs: { bad, good: Fixture.LegacyRecord() } })
    const store = await FileTenantConfigStore.Open(storage)
    await assert.rejects(store.Get('bad'), InvalidSecurityModelError)
    assert.equal((await store.Get('good'))?.SecurityModel?.teams.length, 1)
})
