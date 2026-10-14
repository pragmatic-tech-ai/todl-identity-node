import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Tenant, TenantKind, PresentedSecret } from '@pragmatic-tech-ai/todl-identity'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { FileServiceTokenStore } from '../file-service-token-store.js'

const tenant1 = new Tenant('t1', TenantKind.SelfHosted, 'Tenant One')

test('Issue then Resolve returns the grant for the right tenant', async () =>
{
    const store = await FileServiceTokenStore.Open(new FakeStorage())
    const tenant = tenant1
    const { Grant, Token } = await store.Issue(tenant, 'svc1', ['read'], null)
    const resolved = await store.Resolve(tenant, new PresentedSecret(Token))
    assert.equal(resolved?.PrincipalId, 'svc1')
    assert.equal(resolved?.TokenRef, Grant.TokenRef)
})

test('the raw token never reaches disk', async () =>
{
    const storage = new FakeStorage()
    const store = await FileServiceTokenStore.Open(storage)
    const { Token } = await store.Issue(tenant1, 'svc1', [], null)
    const onDisk = await storage.ReadText('service-tokens.json')
    assert.ok(!onDisk.includes(Token))
})

test('tokens survive a reopen and still resolve', async () =>
{
    const storage = new FakeStorage()
    const tenant = tenant1
    const first = await FileServiceTokenStore.Open(storage)
    const { Token } = await first.Issue(tenant, 'svc1', [], null)
    const second = await FileServiceTokenStore.Open(storage)
    assert.equal((await second.Resolve(tenant, new PresentedSecret(Token)))?.PrincipalId, 'svc1')
})

test('expired, wrong-tenant, revoked and unknown tokens resolve to null', async () =>
{
    const past = new Date('2000-01-01T00:00:00Z')
    const store = await FileServiceTokenStore.Open(new FakeStorage())
    const tenant = tenant1
    const other = new Tenant('t2', TenantKind.SelfHosted, 'Other')

    const expired = await store.Issue(tenant, 'svc1', [], past)
    assert.equal(await store.Resolve(tenant, new PresentedSecret(expired.Token)), null)

    const ok = await store.Issue(tenant, 'svc2', [], null)
    assert.equal(await store.Resolve(other, new PresentedSecret(ok.Token)), null)

    await store.Revoke(tenant, ok.Grant.TokenRef)
    assert.equal(await store.Resolve(tenant, new PresentedSecret(ok.Token)), null)

    assert.equal(await store.Resolve(tenant, new PresentedSecret('not-a-token')), null)
})

test('List is tenant-scoped, reflects revocation and never exposes the token value', async () =>
{
    const store = await FileServiceTokenStore.Open(new FakeStorage())
    const other = new Tenant('t2', TenantKind.SelfHosted, 'Other')
    const issued = await store.Issue(tenant1, 'svc1', ['read'], null)
    await store.Issue(other, 'svc2', [], null)
    let listed = await store.List(tenant1)
    assert.equal(listed.length, 1)
    assert.equal(listed[0].TokenRef, issued.Grant.TokenRef)
    assert.equal(listed[0].PrincipalId, 'svc1')
    assert.deepEqual(listed[0].Scopes, ['read'])
    assert.equal(listed[0].Revoked, false)
    assert.ok(!JSON.stringify(listed).includes(issued.Token))
    await store.Revoke(tenant1, issued.Grant.TokenRef)
    listed = await store.List(tenant1)
    assert.equal(listed[0].Revoked, true)
    assert.equal((await store.List(other)).length, 1)
})
