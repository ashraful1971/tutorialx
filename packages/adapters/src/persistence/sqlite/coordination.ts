import {
  idSchema,
  type ResourceCoordinator,
  type ResourceLease,
  timestampSchema,
  type UsageReservation,
  usdMicrosSchema,
} from '@tutorialx/contracts';
import { MetadataConflict, MetadataPolicyError, type SqliteDatabase } from './database.js';

function reservation(input: UsageReservation): UsageReservation {
  const value = structuredClone(input);
  if (
    Object.keys(value).sort().join(',') !==
    'actualUsdMicros,id,operationId,reservedUsdMicros,scopes,state'
  )
    throw new Error('Unknown usage reservation fields.');
  idSchema.parse(value.id);
  idSchema.parse(value.operationId);
  usdMicrosSchema.parse(value.reservedUsdMicros);
  if (value.actualUsdMicros !== null) usdMicrosSchema.parse(value.actualUsdMicros);
  if (
    !['reserved', 'settled', 'uncertain', 'released'].includes(value.state) ||
    value.scopes.length < 1 ||
    value.scopes.length > 100 ||
    new Set(value.scopes.map((scope) => scope.id)).size !== value.scopes.length
  )
    throw new Error('Invalid usage reservation.');
  for (const scope of value.scopes) {
    if (Object.keys(scope).sort().join(',') !== 'id,kind,limitUsdMicros')
      throw new Error('Unknown usage scope fields.');
    idSchema.parse(scope.id);
    usdMicrosSchema.parse(scope.limitUsdMicros);
    if (!['job', 'batch'].includes(scope.kind)) throw new Error('Invalid usage scope.');
  }
  return value;
}

export function sqliteUsage(
  db: SqliteDatabase,
  transaction: SqliteDatabase['transaction'] = db.transaction,
) {
  const read = (id: string) =>
    db.decode<UsageReservation>(db.get('SELECT json FROM usage WHERE id=?', idSchema.parse(id)));
  function required(id: string) {
    const value = read(id);
    if (!value) throw new Error('Usage reservation not found.');
    return value;
  }
  function store(value: UsageReservation) {
    db.run(
      'UPDATE usage SET reserved=?, actual=?, state=?, json=? WHERE id=?',
      value.reservedUsdMicros,
      value.actualUsdMicros,
      value.state,
      JSON.stringify(value),
      value.id,
    );
  }
  function usage(scopeId: string) {
    const row = db.get(
      `SELECT COALESCE(SUM(CASE WHEN u.state IN ('reserved','uncertain') THEN u.reserved ELSE 0 END),0) reserved, COALESCE(SUM(COALESCE(u.actual,0)),0) actual FROM usage u JOIN usage_members m ON m.reservation_id=u.id WHERE m.scope_id=?`,
      idSchema.parse(scopeId),
    );
    return {
      reservedUsdMicros: usdMicrosSchema.parse(row?.reserved),
      actualUsdMicros: usdMicrosSchema.parse(row?.actual),
    };
  }
  return {
    reserveUsage(input: UsageReservation) {
      db.requireReady();
      const value = reservation(input);
      if (value.state !== 'reserved' || value.actualUsdMicros !== null)
        throw new Error('New reservations must be reserved with unknown actual usage.');
      transaction(() => {
        const existing = read(value.id);
        if (existing) {
          if (
            JSON.stringify({ ...existing, actualUsdMicros: null, state: 'reserved' }) !==
            JSON.stringify(value)
          )
            throw new MetadataConflict('Reservation identity already has another value.');
          return;
        }
        for (const scope of value.scopes) {
          const recorded = db.get('SELECT kind,ceiling FROM usage_scopes WHERE id=?', scope.id);
          if (
            recorded &&
            (recorded.kind !== scope.kind || Number(recorded.ceiling) !== scope.limitUsdMicros)
          )
            throw new MetadataConflict('Usage scope limits cannot change implicitly.');
          const current = usage(scope.id);
          if (
            BigInt(current.reservedUsdMicros) +
              BigInt(current.actualUsdMicros) +
              BigInt(value.reservedUsdMicros) >
            BigInt(scope.limitUsdMicros)
          )
            throw new MetadataPolicyError('Authorized usage budget would be exceeded.');
          if (!recorded)
            db.run(
              'INSERT INTO usage_scopes(id,kind,ceiling) VALUES (?,?,?)',
              scope.id,
              scope.kind,
              scope.limitUsdMicros,
            );
        }
        db.run(
          'INSERT INTO usage(id,operation_id,reserved,actual,state,json) VALUES (?,?,?,?,?,?)',
          value.id,
          value.operationId,
          value.reservedUsdMicros,
          null,
          value.state,
          JSON.stringify(value),
        );
        for (const scope of value.scopes)
          db.run(
            'INSERT INTO usage_members(reservation_id,scope_id) VALUES (?,?)',
            value.id,
            scope.id,
          );
      });
    },
    settleUsage(id: string, actual: number) {
      db.requireReady();
      usdMicrosSchema.parse(actual);
      transaction(() => {
        const value = required(id);
        if (value.state === 'settled') {
          if (value.actualUsdMicros !== actual)
            throw new MetadataConflict('Actual usage was already settled differently.');
          return;
        }
        store({ ...value, actualUsdMicros: actual, state: 'settled' });
      });
    },
    markUsageUncertain(id: string) {
      db.requireReady();
      transaction(() => {
        const value = required(id);
        if (value.state === 'uncertain') return;
        if (value.state !== 'reserved')
          throw new MetadataConflict('Only a reserved operation can become uncertain.');
        store({ ...value, state: 'uncertain' });
      });
    },
    releaseUsage(id: string) {
      db.requireReady();
      transaction(() => {
        const value = required(id);
        if (value.state === 'released') return;
        if (value.state !== 'reserved')
          throw new MetadataPolicyError('Uncertain or settled usage cannot be released as unused.');
        store({ ...value, state: 'released' });
      });
    },
    usage,
  };
}

export function sqliteCoordination(
  db: SqliteDatabase,
  base: Pick<
    ResourceCoordinator,
    'descriptor' | 'validateConfiguration' | 'readiness' | 'estimate'
  >,
): ResourceCoordinator {
  const ledger = sqliteUsage(db);
  return {
    ...base,
    reserveUsage: async (input) => ledger.reserveUsage(input),
    settleUsage: async (id, actual) => ledger.settleUsage(id, actual),
    markUsageUncertain: async (id) => ledger.markUsageUncertain(id),
    releaseUsage: async (id) => ledger.releaseUsage(id),
    usage: async (id) => ledger.usage(id),
    async acquireResource(resourceId, ownerId, expiresAt) {
      db.requireReady();
      idSchema.parse(resourceId);
      idSchema.parse(ownerId);
      timestampSchema.parse(expiresAt);
      return db.transaction(() => {
        const now = db.clock();
        const expiry = new Date(expiresAt).toISOString();
        if (expiry <= now) throw new Error('A resource lease must expire in the future.');
        const old = db.get('SELECT * FROM locks WHERE id=?', resourceId);
        if (old && old.released === 0 && String(old.expires_at) > now) {
          if (old.owner_id === ownerId && old.expires_at === expiry)
            return { resourceId, ownerId, token: Number(old.token), expiresAt: expiry };
          return null;
        }
        const token = Number(old?.token ?? 0) + 1;
        if (!Number.isSafeInteger(token)) throw new Error('Resource fencing token exhausted.');
        db.run(
          'INSERT INTO locks(id,owner_id,token,expires_at,released) VALUES (?,?,?,?,0) ON CONFLICT(id) DO UPDATE SET owner_id=excluded.owner_id,token=excluded.token,expires_at=excluded.expires_at,released=0',
          resourceId,
          ownerId,
          token,
          expiry,
        );
        return { resourceId, ownerId, token, expiresAt: expiry };
      });
    },
    async renewResource(lease, expiresAt): Promise<ResourceLease> {
      db.requireReady();
      timestampSchema.parse(expiresAt);
      return db.transaction(() => {
        const now = db.clock();
        const expiry = new Date(expiresAt).toISOString();
        const row = db.get('SELECT * FROM locks WHERE id=?', idSchema.parse(lease.resourceId));
        if (
          !row ||
          row.released !== 0 ||
          row.owner_id !== lease.ownerId ||
          row.token !== lease.token ||
          row.expires_at !== new Date(lease.expiresAt).toISOString() ||
          String(row.expires_at) <= now ||
          expiry <= now ||
          expiry < String(row.expires_at)
        )
          throw new MetadataConflict('Resource lease is stale or expired.');
        db.run('UPDATE locks SET expires_at=? WHERE id=?', expiry, lease.resourceId);
        return { ...lease, expiresAt: expiry };
      });
    },
    async releaseResource(lease) {
      db.requireReady();
      db.transaction(() => {
        const row = db.get('SELECT * FROM locks WHERE id=?', idSchema.parse(lease.resourceId));
        if (
          !row ||
          row.owner_id !== lease.ownerId ||
          row.token !== lease.token ||
          row.expires_at !== new Date(lease.expiresAt).toISOString()
        )
          throw new MetadataConflict('Resource lease is stale.');
        db.run('UPDATE locks SET released=1 WHERE id=?', lease.resourceId);
      });
    },
  };
}
