// Write idempotency for the curator API. Completed responses are replayed for
// 24 hours. A pending claim older than the Desk apply lease can be taken over,
// because approve/insert are themselves guarded by proposal state and dedupe.
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  deleteIngestStateIfPending,
  getIngestState,
  insertIngestStateIfAbsent,
  setIngestState,
  takeExpiredIngestState,
} from './desk-store';

const PENDING_MS = 15 * 60 * 1000;
const DONE_MS = 24 * 60 * 60 * 1000;

export interface IdempotencyRecord {
  state: 'pending' | 'done';
  at: string;
  body_hash: string;
  status?: number;
  body?: unknown;
}

export type IdempotencyClaim =
  | 'claimed'
  | 'pending'
  | 'mismatch'
  | { replay: { status: number; body: unknown } };

export interface IdempotencyStore {
  claim(key: string, bodyHash: string, at: string): Promise<IdempotencyClaim>;
  finish(key: string, status: number, body: unknown, bodyHash: string, at: string): Promise<void>;
  release(key: string): Promise<void>;
}

export function interpretIdempotency(existing: unknown, bodyHash: string, now: number): IdempotencyClaim | 'expired' {
  if (!existing || typeof existing !== 'object') return 'pending';
  const record = existing as Partial<IdempotencyRecord>;
  if ((record.state !== 'pending' && record.state !== 'done') || typeof record.at !== 'string' || typeof record.body_hash !== 'string') {
    return 'pending';
  }
  const at = Date.parse(record.at);
  if (!Number.isFinite(at)) return 'pending';
  if (record.state === 'pending') return at + PENDING_MS <= now ? 'expired' : 'pending';
  if (at + DONE_MS <= now) return 'expired';
  if (record.body_hash !== bodyHash) return 'mismatch';
  if (typeof record.status !== 'number') return 'pending';
  return { replay: { status: record.status, body: record.body ?? null } };
}

interface IdempotencyAdapter {
  read(key: string): Promise<unknown>;
  insert(key: string, value: IdempotencyRecord): Promise<boolean>;
  takeExpired(key: string, value: IdempotencyRecord, pendingBefore: string, doneBefore: string): Promise<boolean>;
  write(key: string, value: IdempotencyRecord): Promise<void>;
  deletePending(key: string): Promise<void>;
}

function pendingRecord(bodyHash: string, at: string): IdempotencyRecord {
  return { state: 'pending', at, body_hash: bodyHash };
}

export function createIdempotencyStore(adapter: IdempotencyAdapter, now = Date.now): IdempotencyStore {
  return {
    async claim(key, bodyHash, at) {
      const pending = pendingRecord(bodyHash, at);
      if (await adapter.insert(key, pending)) return 'claimed';
      const timestamp = now();
      let view = interpretIdempotency(await adapter.read(key), bodyHash, timestamp);
      if (view === 'expired') {
        const pendingBefore = new Date(timestamp - PENDING_MS).toISOString();
        const doneBefore = new Date(timestamp - DONE_MS).toISOString();
        if (await adapter.takeExpired(key, pending, pendingBefore, doneBefore)) return 'claimed';
        view = interpretIdempotency(await adapter.read(key), bodyHash, now());
      }
      if (view === 'expired') return 'pending';
      return view;
    },
    async finish(key, status, body, bodyHash, at) {
      await adapter.write(key, { state: 'done', at, body_hash: bodyHash, status, body });
    },
    release(key) {
      return adapter.deletePending(key);
    },
  };
}

export function memoryIdempotencyStore(now = Date.now): IdempotencyStore {
  const records = new Map<string, IdempotencyRecord>();
  let chain = Promise.resolve();
  const exclusive = <T>(fn: () => T): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };
  return createIdempotencyStore(
    {
      read: (key) => exclusive(() => records.get(key) ?? null),
      insert: (key, value) =>
        exclusive(() => {
          if (records.has(key)) return false;
          records.set(key, value);
          return true;
        }),
      takeExpired: (key, value, pendingBefore, doneBefore) =>
        exclusive(() => {
          const current = records.get(key);
          if (!current) return false;
          const expired =
            (current.state === 'pending' && current.at <= pendingBefore) ||
            (current.state === 'done' && current.at <= doneBefore);
          if (!expired) return false;
          records.set(key, value);
          return true;
        }),
      write: (key, value) =>
        exclusive(() => {
          records.set(key, value);
        }),
      deletePending: (key) =>
        exclusive(() => {
          const current = records.get(key);
          if (current?.state === 'pending') records.delete(key);
        }),
    },
    now
  );
}

function readFileStore(path: string): Record<string, IdempotencyRecord> {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { records?: unknown };
    if (!parsed || typeof parsed !== 'object' || !parsed.records || typeof parsed.records !== 'object') return {};
    return parsed.records as Record<string, IdempotencyRecord>;
  } catch {
    return {};
  }
}

function writeFileStore(path: string, records: Record<string, IdempotencyRecord>): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify({ records }), { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, path);
}

export function fileIdempotencyStore(path: string, now = Date.now): IdempotencyStore {
  let chain = Promise.resolve();
  const exclusive = <T>(fn: () => T): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };
  return createIdempotencyStore(
    {
      read: (key) => exclusive(() => readFileStore(path)[key] ?? null),
      insert: (key, value) =>
        exclusive(() => {
          const records = readFileStore(path);
          if (Object.prototype.hasOwnProperty.call(records, key)) return false;
          records[key] = value;
          writeFileStore(path, records);
          return true;
        }),
      takeExpired: (key, value, pendingBefore, doneBefore) =>
        exclusive(() => {
          const records = readFileStore(path);
          const current = records[key];
          if (!current) return false;
          const expired =
            (current.state === 'pending' && current.at <= pendingBefore) ||
            (current.state === 'done' && current.at <= doneBefore);
          if (!expired) return false;
          records[key] = value;
          writeFileStore(path, records);
          return true;
        }),
      write: (key, value) =>
        exclusive(() => {
          const records = readFileStore(path);
          records[key] = value;
          writeFileStore(path, records);
        }),
      deletePending: (key) =>
        exclusive(() => {
          const records = readFileStore(path);
          if (records[key]?.state !== 'pending') return;
          delete records[key];
          writeFileStore(path, records);
        }),
    },
    now
  );
}

function pgIdempotencyStore(now = Date.now): IdempotencyStore {
  return createIdempotencyStore(
    {
      read: (key) => getIngestState(key),
      insert: (key, value) => insertIngestStateIfAbsent(key, value),
      takeExpired: (key, value, pendingBefore, doneBefore) => takeExpiredIngestState(key, value, pendingBefore, doneBefore),
      write: (key, value) => setIngestState(key, value),
      deletePending: (key) => deleteIngestStateIfPending(key),
    },
    now
  );
}

export function defaultIdempotencyStore(): IdempotencyStore {
  if (process.env.DATABASE_URL) return pgIdempotencyStore();
  return fileIdempotencyStore(join(process.cwd(), '.data', 'curator-idempotency.json'));
}
