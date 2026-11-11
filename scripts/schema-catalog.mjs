import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { schemaCatalog } from '@tutorialx/contracts';

const destination = fileURLToPath(new URL('../schemas/v1/catalog.json', import.meta.url));
const generated = `${JSON.stringify(schemaCatalog(), null, 2)}\n`;
/** @param {string} baselinePath */
export async function checkSchemaCatalog(baselinePath = destination) {
  const baseline = await readFile(baselinePath, 'utf8');
  if (baseline !== generated) {
    throw new Error(
      'Public schema catalog changed. Review versioning/migration requirements, then regenerate deliberately with pnpm schema:update.',
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes('--write')) {
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, generated);
      process.stdout.write(
        'Updated schemas/v1/catalog.json; review contract compatibility before committing.\n',
      );
    } else {
      await checkSchemaCatalog();
      process.stdout.write('Public schemas match the reviewed version 1 catalog.\n');
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
