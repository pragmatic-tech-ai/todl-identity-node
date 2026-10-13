import { randomBytes } from 'node:crypto'
import type { IdentityStoreSet } from '@pragmatic-tech-ai/todl-identity'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { FileIdentityStores } from '../file-identity-stores.js'

export class NodeStoresFixture
{
    public static async Open(): Promise<IdentityStoreSet>
    {
        return FileIdentityStores.Open(new FakeStorage(), randomBytes(32))
    }

    public static async Dispose(): Promise<void>
    {
    }
}
