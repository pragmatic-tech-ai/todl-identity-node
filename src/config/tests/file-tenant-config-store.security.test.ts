import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IdentityConfig, DelegationDepth, OwnershipSourceKind } from '@pragmatic-tech-ai/todl-identity'
import type { ISecurityModelConfig } from '@pragmatic-tech-ai/todl-identity'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { FileTenantConfigStore } from '../file-tenant-config-store.js'

class Fixture
{
    public static SecurityModel(): ISecurityModelConfig
    {
        return {
            businessUnits: [{ id: 'root', name: 'Root' }, { id: 'eng', name: 'Eng', parent: 'root' }],
            teams: [{ id: 't-web', name: 'Web', owningBusinessUnit: 'eng' }],
            membership: { claimsMapping: [{ claim: 'dept', value: 'eng', homeBusinessUnit: 'eng', teams: ['t-web'] }], overrides: [{ principalId: 'u1', teams: [] }] },
            ownershipRules: [{ concept: 'shop.Order', owningBusinessUnit: { kind: OwnershipSourceKind.FromField, value: 'region' }, owner: { kind: OwnershipSourceKind.Fixed, value: 't-web' } }],
        }
    }

    public static ConfigWith(model: ISecurityModelConfig | undefined): IdentityConfig
    {
        return new IdentityConfig('server-pack', DelegationDepth.FullAuthz, new Map(), new Map(), new Map(), model)
    }
}

test('a SecurityModel round-trips through Save/Get and a reopen', async () =>
{
    const storage = new FakeStorage()
    const store = await FileTenantConfigStore.Open(storage)
    await store.Save('t1', Fixture.ConfigWith(Fixture.SecurityModel()))

    const reopened = await FileTenantConfigStore.Open(storage)
    const got = await reopened.Get('t1')
    assert.deepEqual(got?.SecurityModel, Fixture.SecurityModel())
    // the string enum persists as its token, not a numeric index
    assert.equal(got?.SecurityModel?.ownershipRules[0].owningBusinessUnit.kind, 'fromField')
})

test('an absent SecurityModel round-trips as undefined', async () =>
{
    const store = await FileTenantConfigStore.Open(new FakeStorage())
    await store.Save('t1', Fixture.ConfigWith(undefined))
    assert.equal((await store.Get('t1'))?.SecurityModel, undefined)
})
