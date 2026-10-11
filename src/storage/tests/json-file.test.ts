import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { JsonFile } from '../json-file.js'

test('Read returns the fallback when the file does not exist', async () =>
{
    const file = new JsonFile(new FakeStorage(), 'x.json')
    const value = await file.Read<{ a: number }>({ a: 7 })
    assert.deepEqual(value, { a: 7 })
})

test('Write then Read round-trips the value', async () =>
{
    const storage = new FakeStorage()
    const file = new JsonFile(storage, 'x.json')
    await file.Write({ a: 1, b: 'two' })
    const value = await file.Read<{ a: number; b: string }>({ a: 0, b: '' })
    assert.deepEqual(value, { a: 1, b: 'two' })
})

test('Read returns the fallback on corrupt JSON (fail-closed, no throw)', async () =>
{
    const storage = new FakeStorage()
    await storage.WriteText('x.json', '{ this is not json')
    const file = new JsonFile(storage, 'x.json')
    const value = await file.Read<Record<string, string>>({})
    assert.deepEqual(value, {})
})

test('writes persist in submission order', async () =>
{
    const storage = new FakeStorage()
    const file = new JsonFile(storage, 'x.json')
    const first = file.Write({ n: 1 })
    const second = file.Write({ n: 2 })
    await Promise.all([first, second])
    assert.deepEqual(await file.Read<{ n: number }>({ n: 0 }), { n: 2 })
})

test('a failed write does not brick later writes (chain self-heals)', async () =>
{
    class FlakyStorage extends FakeStorage
    {
        public failNext = true
        public override async WriteText(path: string, content: string): Promise<void>
        {
            if (this.failNext)
            {
                this.failNext = false
                throw new Error('disk full')
            }
            await super.WriteText(path, content)
        }
    }
    const storage = new FlakyStorage()
    const file = new JsonFile(storage, 'x.json')
    await assert.rejects(() => file.Write({ a: 1 }))
    await file.Write({ a: 2 })
    assert.deepEqual(await file.Read<{ a: number }>({ a: 0 }), { a: 2 })
})

test('a file containing null reads as the fallback', async () =>
{
    const storage = new FakeStorage()
    await storage.WriteText('x.json', 'null')
    const file = new JsonFile(storage, 'x.json')
    assert.deepEqual(await file.Read<Record<string, string>>({ a: 'x' }), { a: 'x' })
})
