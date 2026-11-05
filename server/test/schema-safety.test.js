const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const schemaPath = path.join(__dirname, '../../database/mysql/schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');

test('database initialization schema never drops existing tables', () => {
  assert.doesNotMatch(schema, /\bDROP\s+TABLE\b/i);
});

test('database initialization creates tables only when missing', () => {
  const createStatements = schema.match(/\bCREATE\s+TABLE\b/gi) || [];
  const safeStatements = schema.match(/\bCREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\b/gi) || [];
  assert.ok(createStatements.length > 0, 'schema must define at least one table');
  assert.equal(safeStatements.length, createStatements.length);
});
