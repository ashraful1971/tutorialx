import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FOUNDATION_ACTION_SCHEMAS, foundationActionSchema } from '@tutorialx/contracts';
import { foundationActionDescriptors } from '../packages/cli/dist/index.js';
import { SKILL_FILES } from './skill-files.mjs';

const source = fileURLToPath(new URL('../skills/tutorialx/', import.meta.url));
const destination = fileURLToPath(
  new URL('../packages/cli/dist/skills/tutorialx/', import.meta.url),
);

export function generatedSkillReference() {
  const descriptors = new Map(
    foundationActionDescriptors().map((descriptor) => [descriptor.name, descriptor]),
  );
  const rows = Object.keys(FOUNDATION_ACTION_SCHEMAS)
    .sort()
    .map((name) => {
      const descriptor = descriptors.get(name);
      if (!descriptor) throw new Error(`Action ${name} lacks a public descriptor.`);
      const schema = foundationActionSchema(name);
      const branches = schema.oneOf ?? schema.anyOf ?? [schema];
      const required = branches
        .map((branch, index) => {
          const fields = branch.required ?? [];
          const label = branches.length > 1 ? `Variant ${index + 1}: ` : '';
          return `${label}${fields.length ? fields.map((field) => `\`${field}\``).join(', ') : 'None'}`;
        })
        .join('<br>');
      return `| \`${name}\` | ${required} | ${descriptor.requiresRevision ? 'Yes' : 'No'} | ${descriptor.requiresIdempotency ? 'Yes' : 'No'} | ${descriptor.requiredCapabilities.join(', ') || 'Transport scope'} |`;
    });
  return `# Generated action reference\n\nGenerated from version 1 action schemas and public descriptors. Run \`node scripts/skill-reference.mjs --write\` after building to refresh. Retrieve complete schemas from the running engine; this table is a compact routing index.\n\n| Action | Required params | Expected revision | Idempotency key | Capability |\n| --- | --- | --- | --- | --- |\n${rows.join('\n')}\n\nCall \`tutorialx schema job.submit --json\` for an action input or \`tutorialx schema PlanRevision --json\` for a public record. Send the complete envelope with \`tutorialx action --input request.json --json\`:\n\n\`\`\`json\n{\n  "apiVersion": 1,\n  "requestId": "request_context",\n  "action": "job.context",\n  "params": { "jobId": "job_example", "role": "researcher" },\n  "expectedRevision": null,\n  "idempotencyKey": null\n}\n\`\`\`\n\nFor mutations, use the current positive job revision and a stable SHA256 hexadecimal idempotency key when marked above. Job creation requires an idempotency key but has no prior job revision. Read responses through the versioned ActionResponse envelope; an accepted asynchronous request is not completed production.\n`;
}

export async function checkSkillReference() {
  if (
    (await readFile(resolve(source, 'references/actions.md'), 'utf8')) !== generatedSkillReference()
  )
    throw new Error(
      'Bundled skill action reference is stale. Build and run node scripts/skill-reference.mjs --write.',
    );
}

export async function bundleSkill() {
  await checkSkillReference();
  for (const name of SKILL_FILES) {
    const target = resolve(destination, name);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(resolve(source, name), target);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--write')) {
    const target = resolve(source, 'references/actions.md');
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, generatedSkillReference());
  } else await checkSkillReference();
  if (process.argv.includes('--bundle')) await bundleSkill();
}
