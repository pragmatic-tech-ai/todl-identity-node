import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IdpDirectorySnapshot, IdpUserState } from '@pragmatic-tech-ai/todl-identity'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { FileIdpDirectoryStore } from '../file-idp-directory-store.js'

test('file directory store round-trips states and members per tenant, survives reopen, unknown tenant is null', async () =>
{
    const storage = new FakeStorage()
    const store = await FileIdpDirectoryStore.Open(storage)
    const at = new Date('2026-11-11T10:00:00Z')
    await store.Save('t1', new IdpDirectorySnapshot(at, true, new Map([['dana', IdpUserState.Disabled]]), new Map([['hr', ['dana', 'sam']]])))
    await store.Save('t2', new IdpDirectorySnapshot(at, false, new Map([['x', IdpUserState.Enabled]]), new Map()))

    const reopened = await FileIdpDirectoryStore.Open(storage)
    const one = await reopened.Get('t1')
    assert.equal(one?.TakenAt.toISOString(), at.toISOString())
    assert.equal(one?.Authoritative, true)
    assert.equal(one?.StateOf('dana'), IdpUserState.Disabled)
    assert.deepEqual(one?.MembersOf('hr'), ['dana', 'sam'])
    assert.equal((await reopened.Get('t2'))?.StateOf('dana'), IdpUserState.Unknown)
    assert.equal(await reopened.Get('nope'), null)
})
