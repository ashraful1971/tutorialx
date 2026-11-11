import type { BaseProvider } from './descriptor.js';

export interface UsageReservation {
  id: string;
  operationId: string;
  scopes: readonly { id: string; kind: 'job' | 'batch'; limitUsdMicros: number }[];
  reservedUsdMicros: number;
  actualUsdMicros: number | null;
  state: 'reserved' | 'settled' | 'uncertain' | 'released';
}

export interface ResourceLease {
  resourceId: string;
  ownerId: string;
  token: number;
  expiresAt: string;
}

/** Atomic coordination primitives shared by jobs; never emulate them with process-local locks. */
export interface ResourceCoordinator extends BaseProvider<'persistence'> {
  reserveUsage(reservation: UsageReservation): Promise<void>;
  settleUsage(id: string, actualUsdMicros: number): Promise<void>;
  markUsageUncertain(id: string): Promise<void>;
  releaseUsage(id: string): Promise<void>;
  usage(scopeId: string): Promise<{ reservedUsdMicros: number; actualUsdMicros: number }>;
  acquireResource(
    resourceId: string,
    ownerId: string,
    expiresAt: string,
  ): Promise<ResourceLease | null>;
  renewResource(lease: ResourceLease, expiresAt: string): Promise<ResourceLease>;
  releaseResource(lease: ResourceLease): Promise<void>;
}
