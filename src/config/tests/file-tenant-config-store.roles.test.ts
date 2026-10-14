import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IdentityConfig, DelegationDepth, PrivilegeAction, AccessLevel } from '@pragmatic-tech-ai/todl-identity'
import type { ISecurityModelConfig } from '@pragmatic-tech-ai/todl-identity'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { FileTenantConfigStore } from '../file-tenant-config-store.js'

class Fixture
{
    public static SecurityModel(): ISecurityModelConfig
    {
        return {
            businessUnits: [{ id: 'root', name: 'Root' }, { id: 'eng', name: 'Eng', parent: 'root' }],
            teams: [{ id: 't-field', name: 'Field', owningBusinessUnit: 'eng' }],
            membership: { claimsMapping: [], overrides: [] },
            ownershipRules: [],
            roles: [{ id: 'reader', name: 'Reader', privileges: [{ action: PrivilegeAction.Read, concept: 'shop.Order', level: AccessLevel.BusinessUnitAndChildren }] }],
            roleAssignment: { claimsMapping: [{ claim: 'r', value: 'reader', roles: ['reader'] }], overrides: [{ principalId: 'u1', roles: ['reader'] }], teamRoles: [{ teamId: 't-field', roles: ['reader'] }] },
        }
    }

    public static Config(model: ISecurityModelConfig): IdentityConfig
    {
        return new IdentityConfig('server-pack', DelegationDepth.FullAuthz, new Map(), new Map(), new Map(), model)
    }
}

test('roles and roleAssignment round-trip through Save/Get and a reopen', async () =>
{
    const storage = new FakeStorage()
    const store = await FileTenantConfigStore.Open(storage)
    await store.Save('t1', Fixture.Config(Fixture.SecurityModel()))

    const reopened = await FileTenantConfigStore.Open(storage)
    const got = await reopened.Get('t1')
    assert.deepEqual(got?.SecurityModel, Fixture.SecurityModel())
    // enums persist as their string tokens
    assert.equal(got?.SecurityModel?.roles?.[0].privileges[0].action, 'read')
    assert.equal(got?.SecurityModel?.roles?.[0].privileges[0].level, 'businessUnitAndChildren')
})
