import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Tenant, TenantKind, Principal, PrincipalKind } from '@pragmatic-tech-ai/todl-identity'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { FileAccountStore } from '../file-account-store.js'

const tenant1 = new Tenant('t1', TenantKind.SelfHosted, 'Tenant One')

test('CreateAccount then find by email and principal', async () =>
{
    const store = await FileAccountStore.Open(new FakeStorage())
    const tenant = tenant1
    await store.CreateAccount(tenant, 'a@x.io', 'p1', 't1/pwhash/p1')
    assert.equal((await store.FindByEmail(tenant, 'a@x.io'))?.PrincipalId, 'p1')
    assert.equal((await store.FindByPrincipalId(tenant, 'p1'))?.Email, 'a@x.io')
})

test('accounts survive a reopen', async () =>
{
    const storage = new FakeStorage()
    const tenant = tenant1
    const first = await FileAccountStore.Open(storage)
    await first.CreateAccount(tenant, 'a@x.io', 'p1', 't1/pwhash/p1')
    const second = await FileAccountStore.Open(storage)
    assert.equal((await second.FindByEmail(tenant, 'a@x.io'))?.PrincipalId, 'p1')
})

test('Lookup returns a User principal; unknown returns null', async () =>
{
    const store = await FileAccountStore.Open(new FakeStorage())
    const tenant = tenant1
    await store.CreateAccount(tenant, 'a@x.io', 'p1', 't1/pwhash/p1')
    const principal = await store.Lookup('p1', tenant)
    assert.equal(principal?.Id, 'p1')
    assert.equal(principal?.Kind, PrincipalKind.User)
    assert.equal(await store.Lookup('nope', tenant), null)
})

test('duplicate email is rejected', async () =>
{
    const store = await FileAccountStore.Open(new FakeStorage())
    const tenant = tenant1
    await store.CreateAccount(tenant, 'a@x.io', 'p1', 'r1')
    await assert.rejects(() => store.CreateAccount(tenant1, 'a@x.io', 'p2', 'r2'), /already registered/)
})

test('duplicate principal id is rejected', async () =>
{
    const store = await FileAccountStore.Open(new FakeStorage())
    await store.CreateAccount(tenant1, 'a@x.io', 'p1', 'r1')
    await assert.rejects(() => store.CreateAccount(tenant1, 'b@x.io', 'p1', 'r2'), /principal already registered/)
})

test('a separator in the principal id is rejected', async () =>
{
    const store = await FileAccountStore.Open(new FakeStorage())
    await assert.rejects(() => store.CreateAccount(tenant1, 'a@x.io', 'p/1', 'r1'), /must not contain the key separator/)
})

test('GroupsOf prefers the principal groups then the stored groups', async () =>
{
    const store = await FileAccountStore.Open(new FakeStorage())
    const tenant = tenant1
    await store.CreateAccount(tenant, 'a@x.io', 'p1', 'r1')
    const withGroups = new Principal('p1', 't1', PrincipalKind.User, new Map(), ['g1'])
    assert.deepEqual(await store.GroupsOf(withGroups), ['g1'])
    const noGroups = new Principal('p1', 't1', PrincipalKind.User, new Map(), [])
    assert.deepEqual(await store.GroupsOf(noGroups), [])
})
