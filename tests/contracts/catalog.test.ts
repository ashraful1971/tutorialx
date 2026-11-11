import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { schemaCatalog } from '@tutorialx/contracts';
import { expect, it } from 'vitest';
import { checkSchemaCatalog } from '../../scripts/schema-catalog.mjs';

it('accepts the reviewed catalog and rejects drift in a prior contract snapshot', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tutorialx-schema-'));
  try {
    const baseline = join(directory, 'catalog.json');
    const catalog = schemaCatalog();
    await writeFile(baseline, `${JSON.stringify(catalog, null, 2)}\n`);
    await expect(checkSchemaCatalog(baseline)).resolves.toBeUndefined();
    const changed = structuredClone(catalog);
    changed.contractVersion = 2 as 1;
    await writeFile(baseline, `${JSON.stringify(changed, null, 2)}\n`);
    await expect(checkSchemaCatalog(baseline)).rejects.toThrow('Public schema catalog changed');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
