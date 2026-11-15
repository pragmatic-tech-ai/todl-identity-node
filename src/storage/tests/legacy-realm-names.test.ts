import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AuditEvent, AuditEventKind, DelegationDepth, Grant, IdentityConfig, IdpDirectorySnapshot, IdpUserState, Principal, PrincipalKind, PresentedSecret, Realm, RealmKind, ResourceKind, ResourceRef, Role } from '@pragmatic-tech-ai/todl-identity'
import { AuditCheckpoint } from '@pragmatic-tech-ai/todl-identity-host'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { FileAccountStore } from '../../accounts/file-account-store.js'
import { FileSessionStore } from '../../sessions/file-session-store.js'
import { FileServiceTokenStore } from '../../tokens/file-service-token-store.js'
import { FileRoleGrantStore } from '../../grants/file-role-grant-store.js'
import { FileAuditSink } from '../../audit/file-audit-sink.js'
import { FileAuditCheckpointStore } from '../../audit/file-audit-checkpoint-store.js'
import { FileIdpDirectoryStore } from '../../directory/file-idp-directory-store.js'
import { FileRealmConfigStore } from '../../config/file-realm-config-store.js'

/** Turns a file written by today's code into the shape files had before the Tenant -> Realm rename. */
class LegacyFx
{
    public static readonly Realm1 = new Realm('t1', RealmKind.SelfHosted, 'Realm One')

    public static async Legacy(storage: FakeStorage, file: string, current: string, legacy: string): Promise<void>
    {
        const text = await storage.ReadText(file)
        assert.ok(text.includes('"' + current + '"'), file + ' was written with ' + current)
        await storage.WriteText(file, text.split('"' + current + '"').join('"' + legacy + '"'))
    }

    public static async Written(storage: FakeStorage, file: string, current: string, legacy: string): Promise<void>
    {
        const text = await storage.ReadText(file)
        assert.ok(text.includes('"' + current + '"'), file + ' is rewritten with ' + current)
        assert.ok(!text.includes('"' + legacy + '"'), file + ' no longer carries ' + legacy)
    }
}

test('reads a legacy accounts.json written with tenantId and writes realmId', async () =>
{
    const storage = new FakeStorage()
    const first = await FileAccountStore.Open(storage)
    await first.CreateAccount(LegacyFx.Realm1, 'a@x.io', 'p1', 't1/pwhash/p1')
    await first.CreateGroup(LegacyFx.Realm1, 'g1', 'Group One')
    await first.AddMember(LegacyFx.Realm1, 'g1', 'p1')
    await LegacyFx.Legacy(storage, 'accounts.json', 'realmId', 'tenantId')
    const second = await FileAccountStore.Open(storage)
    await LegacyFx.Written(storage, 'accounts.json', 'realmId', 'tenantId')
    assert.equal((await second.FindByEmail(LegacyFx.Realm1, 'a@x.io'))?.RealmId, 't1')
    assert.deepEqual((await second.FindByPrincipalId(LegacyFx.Realm1, 'p1'))?.PrincipalId, 'p1')
    await second.CreateAccount(LegacyFx.Realm1, 'b@x.io', 'p2', 't1/pwhash/p2')
    await LegacyFx.Written(storage, 'accounts.json', 'realmId', 'tenantId')
})

test('prefers the new name when a record carries both', async () =>
{
    const storage = new FakeStorage()
    await storage.WriteText('accounts.json', JSON.stringify({ accounts: [{ principalId: 'p1', realmId: 't1', tenantId: 'stale', email: 'a@x.io', secretRef: 's', disabled: false }] }))
    const store = await FileAccountStore.Open(storage)
    assert.equal((await store.FindByEmail(LegacyFx.Realm1, 'a@x.io'))?.RealmId, 't1')
})

test('reads a legacy sessions.json written with tenantId and writes realmId', async () =>
{
    const storage = new FakeStorage()
    const first = await FileSessionStore.Open(storage)
    const session = await first.Issue(new Principal('p1', 't1', PrincipalKind.User, new Map(), []))
    await LegacyFx.Legacy(storage, 'sessions.json', 'realmId', 'tenantId')
    const second = await FileSessionStore.Open(storage)
    await LegacyFx.Written(storage, 'sessions.json', 'realmId', 'tenantId')
    assert.equal((await second.Validate(session.Id))?.RealmId, 't1')
    await second.Issue(new Principal('p2', 't1', PrincipalKind.User, new Map(), []))
    await LegacyFx.Written(storage, 'sessions.json', 'realmId', 'tenantId')
})

test('reads a legacy service-tokens.json written with tenantId and writes realmId', async () =>
{
    const storage = new FakeStorage()
    const first = await FileServiceTokenStore.Open(storage)
    const issued = await first.Issue(LegacyFx.Realm1, 'p1', ['read'], null)
    await LegacyFx.Legacy(storage, 'service-tokens.json', 'realmId', 'tenantId')
    const second = await FileServiceTokenStore.Open(storage)
    await LegacyFx.Written(storage, 'service-tokens.json', 'realmId', 'tenantId')
    assert.equal((await second.Resolve(LegacyFx.Realm1, new PresentedSecret(issued.Token)))?.PrincipalId, 'p1')
    await second.Issue(LegacyFx.Realm1, 'p2', ['read'], null)
    await LegacyFx.Written(storage, 'service-tokens.json', 'realmId', 'tenantId')
})

test('reads a legacy grants.json written with resourceTenantId and writes resourceRealmId', async () =>
{
    const storage = new FakeStorage()
    const first = await FileRoleGrantStore.Open(storage)
    await first.Save(new Grant('p1', Role.Admin, new ResourceRef(ResourceKind.Realm, 't1', [])))
    await LegacyFx.Legacy(storage, 'grants.json', 'resourceRealmId', 'resourceTenantId')
    const second = await FileRoleGrantStore.Open(storage)
    await LegacyFx.Written(storage, 'grants.json', 'resourceRealmId', 'resourceTenantId')
    const grants = await second.GrantsFor('p1', LegacyFx.Realm1)
    assert.equal(grants.length, 1)
    assert.equal(grants[0]!.Resource.RealmId, 't1')
    await second.Save(new Grant('p2', Role.Viewer, new ResourceRef(ResourceKind.Realm, 't1', [])))
    await LegacyFx.Written(storage, 'grants.json', 'resourceRealmId', 'resourceTenantId')
})

test('an audit chain written before the rename still verifies, and the next record writes realmId', async () =>
{
    const storage = new FakeStorage()
    const first = await FileAuditSink.Open(storage)
    const at = new Date('2026-01-01T00:00:00Z')
    await first.Record(new AuditEvent(AuditEventKind.AdminAction, 't1', 'p1', at, new Map([['action', 'a']])))
    await first.Record(new AuditEvent(AuditEventKind.AdminAction, 't1', 'p1', at, new Map([['action', 'b']])))
    await LegacyFx.Legacy(storage, 'audit.json', 'realmId', 'tenantId')
    const second = await FileAuditSink.Open(storage)
    await LegacyFx.Written(storage, 'audit.json', 'realmId', 'tenantId')
    assert.equal(second.Verify('t1'), true)
    assert.equal(second.Records('t1').length, 2)
    await second.Record(new AuditEvent(AuditEventKind.AdminAction, 't1', 'p1', at, new Map([['action', 'c']])))
    assert.equal(second.Verify('t1'), true)
    await LegacyFx.Written(storage, 'audit.json', 'realmId', 'tenantId')
})

test('reads a legacy audit-anchors.json written with tenantId and writes realmId', async () =>
{
    const storage = new FakeStorage()
    const first = await FileAuditCheckpointStore.Open(storage)
    await first.Append(new AuditCheckpoint('t1', 1, 'h1', 'a1', 's1'))
    await LegacyFx.Legacy(storage, 'audit-anchors.json', 'realmId', 'tenantId')
    const second = await FileAuditCheckpointStore.Open(storage)
    await LegacyFx.Written(storage, 'audit-anchors.json', 'realmId', 'tenantId')
    assert.equal((await second.Latest('t1'))?.Sequence, 1)
    assert.deepEqual(await second.Realms(), ['t1'])
    await second.Append(new AuditCheckpoint('t1', 2, 'h2', 'a2', 's2'))
    await LegacyFx.Written(storage, 'audit-anchors.json', 'realmId', 'tenantId')
})

test('reads a legacy idp-directory.json keyed by tenants and writes realms', async () =>
{
    const storage = new FakeStorage()
    const first = await FileIdpDirectoryStore.Open(storage)
    const at = new Date('2026-01-01T00:00:00Z')
    await first.Save('t1', new IdpDirectorySnapshot(at, true, new Map([['dana', IdpUserState.Disabled]]), new Map()))
    await LegacyFx.Legacy(storage, 'idp-directory.json', 'realms', 'tenants')
    const second = await FileIdpDirectoryStore.Open(storage)
    await LegacyFx.Written(storage, 'idp-directory.json', 'realms', 'tenants')
    assert.equal((await second.Get('t1'))?.Users().get('dana'), IdpUserState.Disabled)
    await second.Save('t2', new IdpDirectorySnapshot(at, false, new Map(), new Map()))
    await LegacyFx.Written(storage, 'idp-directory.json', 'realms', 'tenants')
})

class ConfigFx
{
    public static Config(packId: string): IdentityConfig
    {
        return new IdentityConfig(packId, DelegationDepth.ExternalGrants, new Map(), new Map(), new Map())
    }
}

test('opening a legacy tenant-config.json moves it to realm-config.json at once', async () =>
{
    const storage = new FakeStorage()
    const first = await FileRealmConfigStore.Open(storage)
    await first.Save('t1', ConfigFx.Config('local'))
    await storage.WriteText('tenant-config.json', await storage.ReadText('realm-config.json'))
    await storage.Delete('realm-config.json')
    const second = await FileRealmConfigStore.Open(storage)
    assert.equal(await storage.Exists('realm-config.json'), true)
    assert.equal(await storage.Exists('tenant-config.json'), false)
    assert.equal((await second.Get('t1'))?.PackId, 'local')
    await second.Save('t2', ConfigFx.Config('local'))
    assert.equal(await storage.Exists('realm-config.json'), true)
    assert.equal(await storage.Exists('tenant-config.json'), false)
    const third = await FileRealmConfigStore.Open(storage)
    assert.deepEqual([...await third.List()].sort(), ['t1', 't2'])
})

test('ignores a stale tenant-config.json when realm-config.json exists', async () =>
{
    const storage = new FakeStorage()
    const store = await FileRealmConfigStore.Open(storage)
    await store.Save('t1', ConfigFx.Config('current'))
    await storage.WriteText('tenant-config.json', JSON.stringify({ configs: { stale: { packId: 'stale' } } }))
    const reopened = await FileRealmConfigStore.Open(storage)
    assert.equal((await reopened.Get('t1'))?.PackId, 'current')
    assert.deepEqual([...await reopened.List()], ['t1'])
})
