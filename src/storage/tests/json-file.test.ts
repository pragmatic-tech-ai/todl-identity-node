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
