import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Grant, Role, ResourceRef, ResourceKind, Tenant, TenantKind } from '@pragmatic-tech-ai/todl-identity'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { FileRoleGrantStore } from '../file-role-grant-store.js'

const tenant1 = new Tenant('t1', TenantKind.SelfHosted, 'Tenant One')
const editorGrant = new Grant('p1', Role.Editor, new ResourceRef(ResourceKind.Model, 't1', ['sol', 'proj']))

test('Save then GrantsFor returns the subject grants with enums intact', async () =>
{
    const store = await FileRoleGrantStore.Open(new FakeStorage())
    await store.Save(editorGrant)
    const grants = await store.GrantsFor('p1', tenant1)
    assert.equal(grants.length, 1)
    assert.equal(grants[0].Role, Role.Editor)
    assert.equal(grants[0].Resource.Kind, ResourceKind.Model)
    assert.deepEqual([...grants[0].Resource.Path], ['sol', 'proj'])
})

test('grants survive a reopen as real Grant instances', async () =>
{
    const storage = new FakeStorage()
    const first = await FileRoleGrantStore.Open(storage)
    await first.Save(editorGrant)
    const second = await FileRoleGrantStore.Open(storage)
    const grants = await second.GrantsFor('p1', tenant1)
    assert.ok(grants[0] instanceof Grant)
    assert.ok(grants[0].Resource instanceof ResourceRef)
    assert.equal(grants[0].Role, Role.Editor)
})

test('GrantsFor returns only the asked subject', async () =>
{
    const store = await FileRoleGrantStore.Open(new FakeStorage())
    await store.Save(editorGrant)
    await store.Save(new Grant('p2', Role.Viewer, new ResourceRef(ResourceKind.Tenant, 't1', [])))
    assert.equal((await store.GrantsFor('p2', tenant1)).length, 1)
})

test('Revoke removes the matching grant and persists across reopen', async () =>
{
    const storage = new FakeStorage()
    const store = await FileRoleGrantStore.Open(storage)
    await store.Save(editorGrant)
    await store.Revoke(new Grant('p1', Role.Editor, new ResourceRef(ResourceKind.Model, 't1', ['sol', 'proj'])))
    assert.equal((await store.GrantsFor('p1', tenant1)).length, 0)
    const reopened = await FileRoleGrantStore.Open(storage)
    assert.equal((await reopened.GrantsFor('p1', tenant1)).length, 0)
})

test('Revoke leaves a different grant', async () =>
{
    const store = await FileRoleGrantStore.Open(new FakeStorage())
    await store.Save(editorGrant)
    await store.Save(new Grant('p1', Role.Viewer, new ResourceRef(ResourceKind.Model, 't1', ['sol', 'proj'])))
    await store.Save(new Grant('p1', Role.Editor, new ResourceRef(ResourceKind.Model, 't1', ['sol'])))
    await store.Revoke(editorGrant)
    const grants = await store.GrantsFor('p1', tenant1)
    assert.equal(grants.length, 2)
    assert.ok(grants.some(g => g.Role === Role.Viewer))
    assert.ok(grants.some(g => g.Resource.Path.length === 1))
})

test('Revoke is a no-op when nothing matches', async () =>
{
    const store = await FileRoleGrantStore.Open(new FakeStorage())
    await store.Save(editorGrant)
    await store.Revoke(new Grant('p1', Role.Owner, new ResourceRef(ResourceKind.Model, 't1', ['sol', 'proj'])))
    assert.equal((await store.GrantsFor('p1', tenant1)).length, 1)
})

test('GrantsOn returns only grants on exactly the given resource', async () =>
{
    const store = await FileRoleGrantStore.Open(new FakeStorage())
    const root1 = new ResourceRef(ResourceKind.Tenant, 't1', [])
    await store.Save(new Grant('a1', Role.Admin, root1))
    await store.Save(new Grant('a2', Role.Admin, new ResourceRef(ResourceKind.Tenant, 't2', [])))
    await store.Save(new Grant('e1', Role.Editor, new ResourceRef(ResourceKind.Project, 't1', ['sol'])))
    const grants = await store.GrantsOn(root1)
    assert.deepEqual(grants.map(g => g.Subject), ['a1'])
    assert.equal((await store.GrantsOn(new ResourceRef(ResourceKind.Project, 't1', ['sol']))).length, 1)
})
