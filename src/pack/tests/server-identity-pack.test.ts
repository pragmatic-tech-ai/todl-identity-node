import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { AuthMethod, DelegationDepth, Tenant, TenantKind, PresentedSecret, Credential, AuthenticatedResult } from '@pragmatic-tech-ai/todl-identity'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ServerIdentityPack } from '../server-identity-pack.js'
import { FileIdentityStores } from '../file-identity-stores.js'

const tenant1 = new Tenant('t1', TenantKind.SelfHosted, 'Tenant One')

test('Open assembles a FullAuthz pack with local + service-token authenticators', async () =>
{
    const pack = await ServerIdentityPack.Open(new FakeStorage(), randomBytes(32))
    assert.equal(pack.DelegationDepth, DelegationDepth.FullAuthz)
    assert.ok(pack.AuthenticatorFor(AuthMethod.Local))
    assert.ok(pack.AuthenticatorFor(AuthMethod.ServiceToken))
    assert.equal(pack.AuthenticatorFor(AuthMethod.Oidc), undefined)
})

test('a registered account authenticates by local password through the pack', async () =>
{
    const storage = new FakeStorage()
    const pack = await ServerIdentityPack.Open(storage, randomBytes(32))
    await pack.Registrar.Register(tenant1, 'a@x.io', 'p1', new PresentedSecret('pw-123456'))
    const authenticator = pack.AuthenticatorFor(AuthMethod.Local)!
    const result = await authenticator.Authenticate(new Credential(AuthMethod.Local, 'a@x.io'), new PresentedSecret('pw-123456'), tenant1)
    assert.ok(result instanceof AuthenticatedResult)
    assert.equal((result as AuthenticatedResult).Principal.Id, 'p1')
})

test('an injected OIDC authenticator is wired into the pack', async () =>
{
    const stub = { Method: AuthMethod.Oidc, Authenticate: async () => { throw new Error('unused') } }
    const pack = await ServerIdentityPack.Open(new FakeStorage(), randomBytes(32), stub)
    assert.equal(pack.AuthenticatorFor(AuthMethod.Oidc), stub)
})

test('registered accounts and their password hashes persist across reopen', async () =>
{
    const storage = new FakeStorage()
    const key = randomBytes(32)
    const first = await ServerIdentityPack.Open(storage, key)
    await first.Registrar.Register(tenant1, 'a@x.io', 'p1', new PresentedSecret('pw-123456'))
    const second = await ServerIdentityPack.Open(storage, Buffer.from(key))
    const result = await second.AuthenticatorFor(AuthMethod.Local)!.Authenticate(new Credential(AuthMethod.Local, 'a@x.io'), new PresentedSecret('pw-123456'), tenant1)
    assert.ok(result instanceof AuthenticatedResult)
})

test('OpenWith over a file store-set exposes the same stores and authenticators as Open', async () =>
{
    const stores = await FileIdentityStores.Open(new FakeStorage(), randomBytes(32))
    const pack = ServerIdentityPack.OpenWith(stores)
    assert.equal(pack.Secrets, stores.Secrets)
    assert.equal(pack.Tokens, stores.Tokens)
    assert.equal(pack.Directory, stores.Accounts)
    assert.equal(pack.Grants, stores.Grants)
    assert.equal(pack.Sessions, stores.Sessions)
    assert.equal(pack.Audit, stores.Audit)
    assert.ok(pack.AuthenticatorFor(AuthMethod.ServiceToken))
    assert.ok(pack.AuthenticatorFor(AuthMethod.Local))
})
