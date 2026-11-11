const packageNames = ['contracts', 'core', 'adapters', 'cli'];

module.exports = {
  forbidden: [
    { name: 'no-cycles', severity: 'error', from: {}, to: { circular: true } },
    { name: 'no-unresolved', severity: 'error', from: {}, to: { couldNotResolve: true } },
    {
      name: 'core-only-contracts',
      severity: 'error',
      from: { path: '^packages/core/src/' },
      to: { pathNot: '^packages/(core|contracts)/(src|dist)/' },
    },
    {
      name: 'contracts-only-zod',
      severity: 'error',
      from: { path: '^packages/contracts/src/' },
      to: {
        pathNot: [
          '^packages/contracts/',
          '^node_modules/zod/',
          '^node_modules/\\.pnpm/zod@[^/]+/node_modules/zod/',
        ],
      },
    },
    {
      name: 'adapters-cannot-import-cli',
      severity: 'error',
      from: { path: '^packages/adapters/src/' },
      to: { path: '^packages/cli/' },
    },
    ...packageNames.map((name) => ({
      name: `no-deep-imports-from-${name}`,
      severity: 'error',
      from: { path: `^packages/${name}/src/` },
      to: {
        path: '^packages/[^/]+/(src|dist)/',
        pathNot: `^packages/${name}/(src|dist)/`,
        dependencyTypes: ['local'],
      },
    })),
  ],
  options: {
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      conditionNames: ['types', 'import', 'node', 'default'],
      exportsFields: ['exports'],
    },
    doNotFollow: { path: 'node_modules|packages/[^/]+/dist/' },
    exclude: { path: '\\.(test|spec)\\.ts$' },
  },
};
