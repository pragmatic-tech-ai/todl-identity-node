import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { Tenant, TenantKind, Principal, PrincipalKind, Grant, Role, ResourceRef, ResourceKind } from '@pragmatic-tech-ai/todl-identity'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ServerIdentityPack } from '../server-identity-pack.js'
import { AccessContextAssembler } from '../access-context-assembler.js'

const tenant1 = new Tenant('t1', TenantKind.SelfHosted, 'Tenant One')
const principal1 = new Principal('p1', 't1', PrincipalKind.User, new Map(), [])

test('AssembleAsync composes principal, tenant, the subject grants and the pack policy', async () =>
{
    const pack = await ServerIdentityPack.Open(new FakeStorage(), randomBytes(32))
    await pack.Grants.Save(new Grant('p1', Role.Editor, new ResourceRef(ResourceKind.Model, 't1', ['sol'])))
    const context = await new AccessContextAssembler().AssembleAsync(pack, tenant1, principal1)
    assert.equal(context.Principal.Id, 'p1')
    assert.equal(context.Tenant.Id, 't1')
    assert.equal(context.Grants.length, 1)
    assert.equal(context.Grants[0].Role, Role.Editor)
    assert.equal(context.Policy, pack.Policy)
})

test('a principal with no grants assembles an empty-grant context (deny-by-default)', async () =>
{
    const pack = await ServerIdentityPack.Open(new FakeStorage(), randomBytes(32))
    const context = await new AccessContextAssembler().AssembleAsync(pack, tenant1, principal1)
    assert.equal(context.Grants.length, 0)
})
