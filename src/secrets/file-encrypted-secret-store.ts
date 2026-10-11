import { EncryptedSecretStore } from '@pragmatic-tech-ai/todl-identity-local'
import type { ISecretStore } from '@pragmatic-tech-ai/todl-identity'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { JsonFile } from '../storage/json-file.js'

/** Persistent ISecretStore: an EncryptedSecretStore whose ciphertext map is loaded from and
 *  re-persisted to a JSON file on every mutation. Only AES-GCM ciphertext touches disk. */
export class FileEncryptedSecretStore implements ISecretStore
{
    private static readonly FileName = 'secrets.json'

    private readonly inner: EncryptedSecretStore
    private readonly entries: Map<string, string>
    private readonly file: JsonFile

    private constructor(inner: EncryptedSecretStore, entries: Map<string, string>, file: JsonFile)
    {
        this.inner = inner
        this.entries = entries
        this.file = file
    }

    public static async Open(storage: IStorage, masterKey: Buffer): Promise<FileEncryptedSecretStore>
    {
        const file = new JsonFile(storage, FileEncryptedSecretStore.FileName)
        const persisted = await file.Read<Record<string, string>>({})
        const entries = new Map<string, string>(Object.entries(persisted))
        const inner = new EncryptedSecretStore(masterKey, entries)
        return new FileEncryptedSecretStore(inner, entries, file)
    }

    public async Get(reference: string): Promise<string | null>
    {
        return this.inner.Get(reference)
    }

    public async Put(reference: string, secret: string): Promise<void>
    {
        await this.inner.Put(reference, secret)
        await this.persist()
    }

    public async Delete(reference: string): Promise<void>
    {
        await this.inner.Delete(reference)
        await this.persist()
    }

    private persist(): Promise<void>
    {
        return this.file.Write(Object.fromEntries(this.entries))
    }
}
