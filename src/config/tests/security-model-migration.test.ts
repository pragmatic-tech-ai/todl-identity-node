import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SecurityModelMigration } from '../security-model-migration.js'

test('migration: NeedsUpgrade is false for a C5 model', () =>
{
    const model = {
        businessUnits: [{ id: 'root', name: 'Root' }],
        users: [],
        teams: [{ id: 't', name: 'T', businessUnitId: 'root', idpGroups: [], manualMembers: [] }],
        roleAssignments: [],
        profileAssignments: [],
        roleOverrides: [],
        profileOverrides: [],
    }
    assert.equal(SecurityModelMigration.NeedsUpgrade(model), false)
})
