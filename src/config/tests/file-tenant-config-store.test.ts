import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IdentityConfig, DelegationDepth, Role } from '@pragmatic-tech-ai/todl-identity'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { FileTenantConfigStore } from '../file-tenant-config-store.js'

const config = new IdentityConfig(
    'server-pack',
    DelegationDepth.FullAuthz,
    new Map([['issuer', 'https://idp']]),
    new Map([['admins', Role.Admin]]),
    new Map([['email', 'email']]))

test('Save then Get round-trips the config with maps and enums intact', async () =>
{
    const store = await FileTenantConfigStore.Open(new FakeStorage())
    await store.Save('t1', config)
    const got = await store.Get('t1')
    assert.equal(got?.PackId, 'server-pack')
    assert.equal(got?.DelegationDepth, DelegationDepth.FullAuthz)
    assert.equal(got?.ProviderSettings.get('issuer'), 'https://idp')
    assert.equal(got?.GroupRoleMap.get('admins'), Role.Admin)
    assert.equal(got?.ClaimsMapping.get('email'), 'email')
})

test('config survives a reopen; Get on unknown tenant is null; List enumerates', async () =>
{
    const storage = new FakeStorage()
    const first = await FileTenantConfigStore.Open(storage)
    await first.Save('t1', config)
    const second = await FileTenantConfigStore.Open(storage)
    assert.equal((await second.Get('t1'))?.PackId, 'server-pack')
    assert.equal(await second.Get('absent'), null)
    assert.deepEqual([...(await second.List())], ['t1'])
})
