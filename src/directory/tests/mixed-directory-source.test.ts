import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AuditEvent, AuthMethod, IdpDirectorySync, PresentedSecret, Tenant, TenantKind } from '@pragmatic-tech-ai/todl-identity'
import type { AuthenticationResult, Credential, IAuthenticator, IAuditSink, ISecurityModelConfig, ISessionManager } from '@pragmatic-tech-ai/todl-identity'
import { ServerIdentityPack } from '../../pack/server-identity-pack.js'
import { NodeStoresFixture } from '../../pack/tests/node-stores-fixture.js'

class FakeOidc implements IAuthenticator
{
    public readonly Method = AuthMethod.Oidc
    public async Authenticate(_c: Credential, _p: PresentedSecret, _t: Tenant): Promise<AuthenticationResult>
    {
        throw new Error('not called')
    }
}

class RecordingSessions
{
    public readonly Revoked: string[] = []
    public async RevokeAllFor(_tenant: Tenant, principalId: string): Promise<void>
    {
        this.Revoked.push(principalId)
    }
}

class NullAudit
{
    public async Record(_event: AuditEvent): Promise<void>
    {
    }
}

test('mixed pack: a disabled local user is deprovisioned by sync; an external principal stays active', async () =>
{
    const stores = await NodeStoresFixture.Open()
    const pack = ServerIdentityPack.OpenWith(stores, { ExtraAuthenticators: [new FakeOidc()] })
    const tenant = new Tenant('t1', TenantKind.Saas, 'Acme')
    await pack.Registrar.Register(tenant, 'dana@acme.test', 'dana', new PresentedSecret('pw-dana-123456'))
    await pack.Accounts.Disable(tenant, 'dana')
    const config: ISecurityModelConfig = {
        businessUnits: [{ id: 'root', name: 'Root' }],
        users: [],
        teams: [{ id: 'web', name: 'Web', businessUnitId: 'root', idpGroups: [], manualMembers: ['dana', 'ext-oid'] }],
        roleAssignments: [],
        profileAssignments: [],
        roleOverrides: [],
        profileOverrides: [],
    }
    const sessions = new RecordingSessions()
    const sync = new IdpDirectorySync(pack.DirectorySource, pack.IdpDirectory, sessions as unknown as ISessionManager, new NullAudit() as unknown as IAuditSink)
    const result = await sync.Run(tenant, config)
    assert.equal(result.Snapshot.Authoritative, false)
    assert.deepEqual(result.Deprovisioned, ['dana'])
    assert.deepEqual(sessions.Revoked, ['dana'])
    assert.equal(result.Snapshot.IsStateActive('ext-oid'), true)
    await NodeStoresFixture.Dispose()
})
