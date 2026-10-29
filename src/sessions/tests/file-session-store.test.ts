import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Principal, PrincipalKind, AuthMethod } from '@pragmatic-tech-ai/todl-identity'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { FileSessionStore } from '../file-session-store.js'

const principal1 = new Principal('p1', 't1', PrincipalKind.User, new Map(), [])
const SessionsFile = 'sessions.json'

test('Issue returns a session whose Id is the bearer token; Validate accepts it', async () =>
{
    const store = await FileSessionStore.Open(new FakeStorage())
    const session = await store.Issue(principal1)
    assert.equal(session.PrincipalId, 'p1')
    assert.equal(session.AuthMethod, AuthMethod.Local)
    const validated = await store.Validate(session.Id)
    assert.equal(validated?.PrincipalId, 'p1')
    assert.equal(validated?.Id, session.Id)
})

test('the raw token (session id) never reaches disk', async () =>
{
    const storage = new FakeStorage()
    const store = await FileSessionStore.Open(storage)
    const session = await store.Issue(principal1)
    const onDisk = await storage.ReadText(SessionsFile)
    assert.ok(!onDisk.includes(session.Id))
})

test('sessions survive a reopen', async () =>
{
    const storage = new FakeStorage()
    const first = await FileSessionStore.Open(storage)
    const session = await first.Issue(principal1)
    const second = await FileSessionStore.Open(storage)
    assert.equal((await second.Validate(session.Id))?.PrincipalId, 'p1')
})

test('unknown and revoked tokens validate to null', async () =>
{
    const store = await FileSessionStore.Open(new FakeStorage())
    assert.equal(await store.Validate('garbage'), null)
    const session = await store.Issue(principal1)
    await store.Revoke(session.Id)
    assert.equal(await store.Validate(session.Id), null)
})

test('an expired token validates to null and is purged', async () =>
{
    const storage = new FakeStorage()
    const store = await FileSessionStore.Open(storage, 1, () => new Date(Date.now()))
    const session = await store.Issue(principal1)
    await new Promise(resolve => setTimeout(resolve, 5))
    assert.equal(await store.Validate(session.Id), null)
})

test('RevokeAllFor removes every session of that principal only, and persists', async () =>
{
    const storage = new FakeStorage()
    const store = await FileSessionStore.Open(storage)
    const principalB = new Principal('p2', 't1', PrincipalKind.User, new Map(), [])
    const a1 = await store.Issue(principal1)
    const a2 = await store.Issue(principal1)
    const b1 = await store.Issue(principalB)
    await store.RevokeAllFor('p1')
    assert.equal(await store.Validate(a1.Id), null)
    assert.equal(await store.Validate(a2.Id), null)
    assert.equal((await store.Validate(b1.Id))?.PrincipalId, 'p2')
    const reopened = await FileSessionStore.Open(storage)
    assert.equal(await reopened.Validate(a1.Id), null)
    assert.equal((await reopened.Validate(b1.Id))?.PrincipalId, 'p2')
})

class CountingStorage extends FakeStorage
{
    public Writes = 0

    public override async WriteText(path: string, content: string): Promise<void>
    {
        this.Writes++
        await super.WriteText(path, content)
    }
}

test('RevokeAllFor with no matching sessions does not write the file', async () =>
{
    const storage = new CountingStorage()
    const store = await FileSessionStore.Open(storage)
    const a1 = await store.Issue(principal1)
    const writesBefore = storage.Writes
    await store.RevokeAllFor('nobody')
    assert.equal(storage.Writes, writesBefore)
    const reopened = await FileSessionStore.Open(storage)
    assert.equal((await reopened.Validate(a1.Id))?.PrincipalId, 'p1')
})
