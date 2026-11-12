#!/usr/bin/env node
import { runCommand } from './command.js';

process.exitCode = await runCommand(process.argv.slice(2), {
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
  stdin: process.stdin,
});
