// Bounded identity recovery only. Input packets stay private; preview first.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { reviewWireMappings } from '../src/lib/wire-mappings.ts';
const { values } = parseArgs({ options: { input: { type: 'string' }, save: { type: 'boolean', default: false }, 'expected-plan': { type: 'string' } } });
if (!values.input) throw Error('--input is required');
// The local JSON store has only an in-process lock. Durable mapping acceptance
// needs Postgres so separate CLI processes cannot overwrite each other.
if (values.save && !process.env.DATABASE_URL) throw Error('Mapping acceptance requires PostgreSQL DATABASE_URL');
const bytes = readFileSync(values.input);
if (bytes.length > 1_000_000) throw Error('Mapping packet exceeds 1 MB');
console.log(JSON.stringify(await reviewWireMappings(JSON.parse(bytes.toString('utf8')), {
  save: values.save, expectedPlan: values['expected-plan'],
}), null, 2));
