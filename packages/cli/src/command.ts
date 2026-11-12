import { randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { type ActionResponse, actionExitCode, digestSchema } from '@tutorialx/contracts';
import { createActionService, MAX_REQUEST_BYTES } from './actions.js';

export interface CommandIO {
  stdout(text: string): void;
  stderr(text: string): void;
  stdin: AsyncIterable<Uint8Array | string>;
}
const help = `TutorialX foundation commands\n\n\
tutorialx init [--input FILE] [--json]\n\
tutorialx capabilities [--json]\n\
tutorialx schema NAME [--json]\n\
tutorialx job create --input FILE --idempotency-key SHA256 [--json]\n\
tutorialx job inspect|context|submission|list|submit [--input FILE] [--json]\n\
tutorialx source create|inspect|list --input FILE [--json]\n\
tutorialx action --input REQUEST.json [--json]\n\n\
Use --input - for bounded JSON stdin, --workspace DIRECTORY to select a workspace,\n\
--expected-revision NUMBER and --idempotency-key SHA256 for mutations.\n\
All commands are noninteractive. JSON mode writes exactly one response to stdout.\n`;

async function readBounded(input: AsyncIterable<Uint8Array | string>): Promise<string> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of input) {
    const buffer = Buffer.from(chunk);
    length += buffer.length;
    if (length > MAX_REQUEST_BYTES) throw new Error('Input exceeds the maximum byte limit.');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function loadInput(path: string, io: CommandIO) {
  if (path === '-') return JSON.parse(await readBounded(io.stdin));
  const handle = await open(path, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_REQUEST_BYTES)
      throw new Error('Input must be a regular JSON file within the byte limit.');
    return JSON.parse(await readBounded(handle.createReadStream({ autoClose: false })));
  } finally {
    await handle.close();
  }
}

export function renderHumanResponse(response: ActionResponse): string {
  const first =
    response.status === 'error'
      ? `${response.error.code}: ${response.error.message}`
      : response.status === 'waiting'
        ? `${response.code}: waiting for ${response.reason}`
        : response.status === 'accepted'
          ? `Accepted operation ${response.operationId}`
          : 'OK';
  const data = response.status === 'error' ? response.error.details : response.data;
  const actions = response.nextActions
    .map((action) => `Next: ${action.action} — ${action.description}`)
    .join('\n');
  return `${first}\n${JSON.stringify(data, null, 2)}\n${actions ? `${actions}\n` : ''}`;
}

/** CLI uses exactly the same request validator, authority and response as other transports. */
export async function runCommand(
  argv: readonly string[],
  io: CommandIO,
  cwd = process.cwd(),
): Promise<number> {
  const jsonMode = argv.includes('--json');
  let response: ActionResponse;
  try {
    if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) {
      if (!jsonMode) {
        io.stdout(help);
        return 0;
      }
    }
    const flags = new Map<string, string>();
    const words: string[] = [];
    for (let index = 0; index < argv.length; index++) {
      const argument = argv[index]!;
      if (['--json', '--non-interactive', '--help', '-h'].includes(argument)) continue;
      if (!argument.startsWith('-')) {
        words.push(argument);
        continue;
      }
      if (
        ![
          '--input',
          '--workspace',
          '--expected-revision',
          '--idempotency-key',
          '--request-id',
        ].includes(argument)
      )
        throw new Error(`Unknown option ${argument.slice(0, 100)}.`);
      const value = argv[++index];
      if (!value || value.startsWith('--') || flags.has(argument))
        throw new Error(`Supply one value for ${argument}.`);
      flags.set(argument, value);
    }
    const projectDirectory = resolve(cwd, flags.get('--workspace') ?? '.');
    const service = createActionService({
      projectDirectory,
      authority: {
        actorId: 'local_operator',
        actions: ['*'],
        roles: ['researcher', 'writer-director', 'reviewer', 'repair'],
        principalRole: 'operator',
      },
    });
    const input = flags.has('--input') ? await loadInput(flags.get('--input')!, io) : {};
    if (words[0] === 'action') {
      if (words.length !== 1)
        throw new Error('The action command accepts one JSON request envelope.');
      response = await service.execute(input);
    } else {
      let action = words[0] ?? 'capabilities';
      let params = input;
      if (action === 'init') action = 'workspace.init';
      else if (['job', 'source', 'workspace', 'plan', 'artifact', 'skill'].includes(action)) {
        if (!words[1]) throw new Error(`Select a ${action} subcommand.`);
        action = `${action}.${words[1]}`;
        if (words[2] && ['job.inspect', 'job.context'].includes(action))
          params = { ...input, jobId: words[2] };
        else if (words.length > 2) throw new Error('Pass command parameters through --input.');
      } else if (action === 'schema' && words[1]) params = { name: words[1] };
      else if (words.length > 1) throw new Error('Unexpected positional arguments.');
      const expectedRevision = flags.has('--expected-revision')
        ? Number(flags.get('--expected-revision'))
        : null;
      if (
        expectedRevision !== null &&
        (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
      )
        throw new Error('Expected revision must be a positive integer.');
      const idempotencyKey = flags.get('--idempotency-key') ?? null;
      if (idempotencyKey !== null && !digestSchema.safeParse(idempotencyKey).success)
        throw new Error('Idempotency key must be a SHA-256 hexadecimal digest.');
      response = await service.execute({
        apiVersion: 1,
        requestId: flags.get('--request-id') ?? `request_${randomUUID().replaceAll('-', '')}`,
        action,
        params,
        expectedRevision,
        idempotencyKey,
      });
    }
  } catch (error) {
    response = {
      apiVersion: 1,
      requestId: `request_${randomUUID().replaceAll('-', '')}`,
      status: 'error',
      error: {
        code: 'INVALID_INPUT',
        message:
          error instanceof SyntaxError
            ? 'Input must contain valid JSON.'
            : error instanceof Error && !('code' in error)
              ? error.message.slice(0, 1000)
              : 'Input could not be read.',
        retryable: false,
        details: {},
      },
      nextActions: [
        {
          action: 'capabilities',
          description: 'Discover implemented commands and schemas.',
          params: {},
          needsOperator: false,
        },
      ],
    };
  }
  io.stdout(jsonMode ? `${JSON.stringify(response)}\n` : renderHumanResponse(response));
  return actionExitCode(response);
}
