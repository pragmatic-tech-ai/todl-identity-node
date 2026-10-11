import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'

/** Reads/writes one JSON document through an IStorage. Writes are serialised so concurrent
 *  mutations persist in order; a corrupt or absent file reads as the caller's fallback (fail-closed). */
export class JsonFile
{
    private readonly storage: IStorage
    private readonly path: string
    private writeChain: Promise<void> = Promise.resolve()

    public constructor(storage: IStorage, path: string)
    {
        this.storage = storage
        this.path = path
    }

    public async Read<T>(fallback: T): Promise<T>
    {
        if (!(await this.storage.Exists(this.path)))
        {
            return fallback
        }
        try
        {
            return JSON.parse(await this.storage.ReadText(this.path)) as T
        }
        catch
        {
            return fallback
        }
    }

    public Write(value: unknown): Promise<void>
    {
        const text = JSON.stringify(value, null, 2)
        this.writeChain = this.writeChain.then(() => this.storage.WriteText(this.path, text))
        return this.writeChain
    }
}
