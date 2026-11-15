import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Realm, RealmKind, LocalGroupNotFoundError } from '@pragmatic-tech-ai/todl-identity'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { FileAccountStore } from '../file-account-store.js'

const realm = new Realm('t1', RealmKind.Saas, 'Acme')
const other = new Realm('t2', RealmKind.Saas, 'Other')

test('file groups persist across reopen and feed Lookup', async () =>
{
    const storage = new FakeStorage()
    const store = await FileAccountStore.Open(storage)
    await store.CreateAccount(realm, 'dana@x.io', 'dana', 'ref')
    await store.CreateGroup(realm, 'hr-staff', 'HR staff')
    await store.AddMember(realm, 'hr-staff', 'dana')
    await assert.rejects(store.AddMember(realm, 'missing', 'dana'), LocalGroupNotFoundError)
    await assert.rejects(store.CreateGroup(realm, 'hr-staff', 'again'))
    await store.CreateGroup(other, 'hr-staff', 'Other HR')

    const reopened = await FileAccountStore.Open(storage)
    assert.deepEqual((await reopened.Lookup('dana', realm))?.Groups, ['hr-staff'])
    assert.deepEqual((await reopened.ListGroups(realm)).map(g => g.MemberIds), [['dana']])
    assert.deepEqual((await reopened.ListGroups(other)).map(g => g.MemberIds), [[]])
    await reopened.RemoveMember(realm, 'hr-staff', 'dana')
    assert.deepEqual((await reopened.Lookup('dana', realm))?.Groups, [])
})

test('legacy account groups become group records on open', async () =>
{
    const storage = new FakeStorage()
    await storage.WriteText('accounts.json', JSON.stringify({ accounts: [{ principalId: 'p1', realmId: 't1', email: 'a@x.io', secretRef: 'r1', groups: ['g1'] }] }))
    const store = await FileAccountStore.Open(storage)
    assert.deepEqual((await store.Lookup('p1', realm))?.Groups, ['g1'])
    const group = (await store.ListGroups(realm))[0]
    assert.equal(group.Name, 'g1')
    const raw = JSON.parse(await storage.ReadText('accounts.json')) as { accounts: Array<Record<string, unknown>>, groups: unknown[] }
    assert.equal('groups' in raw.accounts[0], false)
    assert.equal(raw.groups.length, 1)
})
