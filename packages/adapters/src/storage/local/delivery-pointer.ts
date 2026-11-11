import { lstat, open, realpath, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  currentDeliveryPointerSchema,
  type DeliveryPointerStore,
  idSchema,
  positiveIntegerSchema,
} from '@tutorialx/contracts';
import { hasCode, managedDirectory } from '../../workspace/files.js';
import { createLocalProjectionFiles } from '../../workspace/local-projections.js';
import { syncDirectory } from './bytes.js';

export class DeliveryPointerConflict extends Error {
  readonly code = 'REVISION_CONFLICT';
}

export function createLocalDeliveryPointerStore(
  jobDirectory: string,
  jobId: string,
): DeliveryPointerStore {
  idSchema.parse(jobId);
  const files = createLocalProjectionFiles(jobDirectory);
  return {
    async lock() {
      if ((await lstat(jobDirectory)).isSymbolicLink())
        throw new Error('Delivery root must not be redirected.');
      const root = await realpath(jobDirectory);
      const directory = await managedDirectory(root, resolve(root, 'output'));
      const lockPath = resolve(directory, '.current-delivery.lock');
      let handle;
      try {
        handle = await open(lockPath, 'wx', 0o600);
      } catch (error) {
        if (hasCode(error, 'EEXIST'))
          throw new DeliveryPointerConflict(
            'Delivery pointer is owned by another operation; reconcile its lock before retrying.',
          );
        throw error;
      }
      let released = false;
      return {
        async invalidate(expectedRevision, nextRevision) {
          if (released)
            throw new DeliveryPointerConflict('Delivery pointer guard has been released.');
          positiveIntegerSchema.parse(expectedRevision);
          positiveIntegerSchema.parse(nextRevision);
          if (nextRevision !== expectedRevision + 1)
            throw new Error('Invalidation must identify the next job revision.');
          const current = await files.read('output/current.json');
          if (!current) return;
          const pointer = currentDeliveryPointerSchema.parse(JSON.parse(current.content));
          if (pointer.jobId !== jobId)
            throw new DeliveryPointerConflict('Delivery pointer belongs to another job.');
          if (pointer.status === 'invalidated' && pointer.jobRevision === nextRevision) return;
          if (pointer.jobRevision > expectedRevision)
            throw new DeliveryPointerConflict('Delivery pointer has a newer revision.');
          await files.write(
            'output/current.json',
            current.content,
            `${JSON.stringify({ schemaVersion: 1, jobId, jobRevision: nextRevision, status: 'invalidated', previousRevision: pointer.status === 'ready' ? pointer.jobRevision : pointer.previousRevision }, null, 2)}\n`,
          );
          await syncDirectory(directory);
        },
        async release() {
          if (!released) {
            await handle.close();
            await unlink(lockPath);
            released = true;
          }
        },
      };
    },
  };
}
