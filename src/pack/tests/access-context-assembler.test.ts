import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { Realm, RealmKind, Principal, PrincipalKind, Grant, Role, ResourceRef, ResourceKind } from '@pragmatic-tech-ai/todl-identity'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ServerIdentityPack } from '../server-identity-pack.js'
import { AccessContextAssembler } from '../access-context-assembler.js'

const realm1 = new Realm('t1', RealmKind.SelfHosted, 'Realm One')
const principal1 = new Principal('p1', 't1', PrincipalKind.User, new Map(), [])

test('AssembleAsync composes principal, realm, the subject grants and the pack policy', async () =>
{
    const pack = await ServerIdentityPack.Open(new FakeStorage(), randomBytes(32))
    await pack.Grants.Save(new Grant('p1', Role.Editor, new ResourceRef(ResourceKind.Model, 't1', ['sol'])))
    const context = await new AccessContextAssembler().AssembleAsync(pack, realm1, principal1)
    assert.equal(context.Principal.Id, 'p1')
    assert.equal(context.Realm.Id, 't1')
    assert.equal(context.Grants.length, 1)
    assert.equal(context.Grants[0].Role, Role.Editor)
    assert.equal(context.Policy, pack.Policy)
})

test('a principal with no grants assembles an empty-grant context (deny-by-default)', async () =>
{
    const pack = await ServerIdentityPack.Open(new FakeStorage(), randomBytes(32))
    const context = await new AccessContextAssembler().AssembleAsync(pack, realm1, principal1)
    assert.equal(context.Grants.length, 0)
})
