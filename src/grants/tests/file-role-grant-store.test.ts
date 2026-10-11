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
