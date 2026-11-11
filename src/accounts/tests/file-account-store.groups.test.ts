import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Tenant, TenantKind, LocalGroupNotFoundError } from '@pragmatic-tech-ai/todl-identity'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { FileAccountStore } from '../file-account-store.js'

const tenant = new Tenant('t1', TenantKind.Saas, 'Acme')
const other = new Tenant('t2', TenantKind.Saas, 'Other')

test('file groups persist across reopen and feed Lookup', async () =>
{
    const storage = new FakeStorage()
    const store = await FileAccountStore.Open(storage)
    await store.CreateAccount(tenant, 'dana@x.io', 'dana', 'ref')
    await store.CreateGroup(tenant, 'hr-staff', 'HR staff')
    await store.AddMember(tenant, 'hr-staff', 'dana')
    await assert.rejects(store.AddMember(tenant, 'missing', 'dana'), LocalGroupNotFoundError)
    await assert.rejects(store.CreateGroup(tenant, 'hr-staff', 'again'))
    await store.CreateGroup(other, 'hr-staff', 'Other HR')

    const reopened = await FileAccountStore.Open(storage)
    assert.deepEqual((await reopened.Lookup('dana', tenant))?.Groups, ['hr-staff'])
    assert.deepEqual((await reopened.ListGroups(tenant)).map(g => g.MemberIds), [['dana']])
    assert.deepEqual((await reopened.ListGroups(other)).map(g => g.MemberIds), [[]])
    await reopened.RemoveMember(tenant, 'hr-staff', 'dana')
    assert.deepEqual((await reopened.Lookup('dana', tenant))?.Groups, [])
})

test('legacy account groups become group records on open', async () =>
{
    const storage = new FakeStorage()
    await storage.WriteText('accounts.json', JSON.stringify({ accounts: [{ principalId: 'p1', tenantId: 't1', email: 'a@x.io', secretRef: 'r1', groups: ['g1'] }] }))
    const store = await FileAccountStore.Open(storage)
    assert.deepEqual((await store.Lookup('p1', tenant))?.Groups, ['g1'])
    const group = (await store.ListGroups(tenant))[0]
    assert.equal(group.Name, 'g1')
    const raw = JSON.parse(await storage.ReadText('accounts.json')) as { accounts: Array<Record<string, unknown>>, groups: unknown[] }
    assert.equal('groups' in raw.accounts[0], false)
    assert.equal(raw.groups.length, 1)
})
