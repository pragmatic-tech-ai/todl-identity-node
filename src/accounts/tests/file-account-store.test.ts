import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LocalAccountNotFoundError, Tenant, TenantKind, Principal, PrincipalKind } from '@pragmatic-tech-ai/todl-identity'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { FileAccountStore } from '../file-account-store.js'

const tenant1 = new Tenant('t1', TenantKind.SelfHosted, 'Tenant One')
const tenant2 = new Tenant('t2', TenantKind.SelfHosted, 'Tenant Two')

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

test('ListAccounts is tenant-scoped and shows Disabled=false for new accounts', async () =>
{
    const store = await FileAccountStore.Open(new FakeStorage())
    await store.CreateAccount(tenant1, 'a@x.io', 'p1', 'r1')
    await store.CreateAccount(tenant2, 'b@x.io', 'p2', 'r2')
    const listed = await store.ListAccounts(tenant1)
    assert.deepEqual(listed.map(a => a.PrincipalId), ['p1'])
    assert.equal(listed[0].Disabled, false)
})

test('Disable hides the account from Lookup but FindBy still returns it, and survives reopen', async () =>
{
    const storage = new FakeStorage()
    const store = await FileAccountStore.Open(storage)
    await store.CreateAccount(tenant1, 'a@x.io', 'p1', 'r1')
    await store.Disable(tenant1, 'p1')
    assert.equal(await store.Lookup('p1', tenant1), null)
    assert.equal((await store.FindByEmail(tenant1, 'a@x.io'))?.Disabled, true)
    assert.equal((await store.FindByPrincipalId(tenant1, 'p1'))?.Disabled, true)
    const reopened = await FileAccountStore.Open(storage)
    assert.equal((await reopened.ListAccounts(tenant1))[0].Disabled, true)
    assert.equal(await reopened.Lookup('p1', tenant1), null)
})

test('Disable of an unknown principal or another tenant throws LocalAccountNotFoundError', async () =>
{
    const store = await FileAccountStore.Open(new FakeStorage())
    await store.CreateAccount(tenant1, 'a@x.io', 'p1', 'r1')
    await assert.rejects(() => store.Disable(tenant1, 'nope'), LocalAccountNotFoundError)
    await assert.rejects(() => store.Disable(tenant2, 'p1'), LocalAccountNotFoundError)
})

test('a legacy record without the disabled field reads back enabled', async () =>
{
    const storage = new FakeStorage()
    await storage.WriteText('accounts.json', JSON.stringify({ accounts: [{ principalId: 'p1', tenantId: 't1', email: 'a@x.io', secretRef: 'r1', groups: [] }] }))
    const store = await FileAccountStore.Open(storage)
    assert.equal((await store.ListAccounts(tenant1))[0].Disabled, false)
    assert.equal((await store.Lookup('p1', tenant1))?.Id, 'p1')
})
