import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AuthMethod, DelegationDepth, ResourceAuthorizationPolicy } from '@pragmatic-tech-ai/todl-identity'
import type { AuthenticationResult, Credential, IAuthenticator, IAccessPolicy, AccessContext, AccessDecision, Action, EntityPredicate, PresentedSecret, ResourceRef, Tenant, IdentityStoreSet } from '@pragmatic-tech-ai/todl-identity'
import { ServerIdentityPack } from '../server-identity-pack.js'
import { NodeStoresFixture } from './node-stores-fixture.js'

const NotCalledMessage = 'not called'

class FakeOidc implements IAuthenticator
{
    public readonly Method = AuthMethod.Oidc
    public async Authenticate(_c: Credential, _p: PresentedSecret, _t: Tenant): Promise<AuthenticationResult>
    {
        throw new Error(NotCalledMessage)
    }
}

class StubPolicy implements IAccessPolicy
{
    public Decide(_c: AccessContext, _a: Action, _r: ResourceRef): AccessDecision
    {
        throw new Error(NotCalledMessage)
    }
    public EntityFilterFor(_c: AccessContext, _a: Action, _concept: string): EntityPredicate
    {
        return { Matches: () => true }
    }
}

test('lone-authenticator OpenWith is unchanged: token+local+oidc, FullAuthz, resource policy', async () =>
{
    const stores: IdentityStoreSet = await NodeStoresFixture.Open()
    const pack = ServerIdentityPack.OpenWith(stores, new FakeOidc())
    assert.ok(pack.AuthenticatorFor(AuthMethod.ServiceToken))
    assert.ok(pack.AuthenticatorFor(AuthMethod.Local))
    assert.ok(pack.AuthenticatorFor(AuthMethod.Oidc))
    assert.equal(pack.DelegationDepth, DelegationDepth.FullAuthz)
    assert.ok(pack.Policy instanceof ResourceAuthorizationPolicy)
    assert.deepEqual(pack.Authenticators.map(a => a.Method), [AuthMethod.ServiceToken, AuthMethod.Local, AuthMethod.Oidc])
    await NodeStoresFixture.Dispose()
})

test('composition OpenWith sets extra authenticators, depth, and policy', async () =>
{
    const stores: IdentityStoreSet = await NodeStoresFixture.Open()
    const policy = new StubPolicy()
    const pack = ServerIdentityPack.OpenWith(stores, { ExtraAuthenticators: [new FakeOidc()], DelegationDepth: DelegationDepth.ExternalGrants, Policy: policy })
    assert.ok(pack.AuthenticatorFor(AuthMethod.Local))
    assert.ok(pack.AuthenticatorFor(AuthMethod.Oidc))
    assert.equal(pack.DelegationDepth, DelegationDepth.ExternalGrants)
    assert.equal(pack.Policy, policy)
    assert.deepEqual(pack.Authenticators.map(a => a.Method), [AuthMethod.ServiceToken, AuthMethod.Local, AuthMethod.Oidc])
    await NodeStoresFixture.Dispose()
})

test('bare OpenWith has only token+local, FullAuthz', async () =>
{
    const stores: IdentityStoreSet = await NodeStoresFixture.Open()
    const pack = ServerIdentityPack.OpenWith(stores)
    assert.ok(pack.AuthenticatorFor(AuthMethod.ServiceToken))
    assert.ok(pack.AuthenticatorFor(AuthMethod.Local))
    assert.equal(pack.AuthenticatorFor(AuthMethod.Oidc), undefined)
    assert.deepEqual(pack.Authenticators.map(a => a.Method), [AuthMethod.ServiceToken, AuthMethod.Local])
    assert.equal(pack.DelegationDepth, DelegationDepth.FullAuthz)
    await NodeStoresFixture.Dispose()
})
