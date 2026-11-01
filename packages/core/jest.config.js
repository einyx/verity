/** @type {import('jest').Config} */
const config = {
  transform: {},
  collectCoverageFrom: ['**/*.{js,ts}'],
  coveragePathIgnorePatterns: ['/node_modules/', '/src/__mocks__/'],
  coverageReporters: ['text-summary', 'lcov'],
  coverageProvider: 'v8',
  // Coverage and embedded-font tests are memory intensive; avoid saturating every host CPU.
  maxWorkers: 2,
  testPathIgnorePatterns: ['/node_modules/', '/build/routes/session/'], // `routes/session` is freezed
  setupFilesAfterEnv: ['jest-matcher-specific-error', './jest.setup.js'],
  roots: ['./build'],
  /**
   * Workers accumulate module registry and v8 coverage state across test files, and the whole run
   * can retain gigabytes before reaching the 4 GB heap cap. Recycle earlier so two core workers
   * and another package's tests fit the CI runner together. Leave room for the largest single-file
   * growth (~1 GB observed); this limit is checked only between test files.
   */
  workerIdleMemoryLimit: '768MB',
  moduleNameMapper: {
    '^#src/(.*)\\.js(x)?$': '<rootDir>/build/$1',
    '^(chalk|inquirer)$': '<rootDir>/../shared/lib/esm/module-proxy.js',
    // pptxgenjs ships an ESM-only entry that Jest cannot load; its CommonJS build is used instead.
    '^pptxgenjs$': '<rootDir>/node_modules/pptxgenjs/dist/pptxgen.cjs.js',
    // Map the connector-kit to the installed version rather than finding it from the `shared` package (which is the default behavior of `mockEsm` in the `shared` package)
    '^@logto/connector-kit$': '<rootDir>/node_modules/@logto/connector-kit/lib/index.js',
  },
};

export default config;
