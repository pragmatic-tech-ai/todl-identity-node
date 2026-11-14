import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuthMethod, Realm, RealmKind, PresentedSecret, Credential, AuthenticatedResult } from '@pragmatic-tech-ai/todl-identity'
import { NodeFsStorage } from '@pragmatic-tech-ai/todl-runtime/node'
import { ServerIdentityPack } from '../pack/server-identity-pack.js'

test('a registered account authenticates and logs in over real disk, secrets by reference only', async () =>
{
    const root = mkdtempSync(join(tmpdir(), 'idn-'))
    try
    {
        const realm = new Realm('t1', RealmKind.SelfHosted, 'Realm One')
        const storage = new NodeFsStorage(root)
        const key = randomBytes(32)
        const pack = await ServerIdentityPack.Open(storage, key)
        await pack.Registrar.Register(realm, 'a@x.io', 'p1', new PresentedSecret('correct horse battery'))

        const result = await pack.AuthenticatorFor(AuthMethod.Local)!.Authenticate(new Credential(AuthMethod.Local, 'a@x.io'), new PresentedSecret('correct horse battery'), realm)
        assert.ok(result instanceof AuthenticatedResult)

        const session = await pack.Sessions.Issue((result as AuthenticatedResult).Principal)
        assert.equal((await pack.Sessions.Validate(session.Id))?.PrincipalId, 'p1')

        for (const name of readdirSync(root))
        {
            assert.ok(!readFileSync(join(root, name), 'utf8').includes('correct horse battery'))
        }
    }
    finally
    {
        rmSync(root, { recursive: true, force: true })
    }
})
