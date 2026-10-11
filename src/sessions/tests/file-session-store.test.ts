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
