/** Jest configuration for the API: SWC transpiles (fast, supports emitDecoratorMetadata). */
module.exports = {
  rootDir: '.',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testEnvironment: 'node',
  testRegex: '.*\\.spec\\.ts$',
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  transform: {
    '^.+\\.(t|j)s$': [
      '@swc/jest',
      {
        jsc: {
          parser: { syntax: 'typescript', decorators: true, dynamicImport: true },
          transform: { legacyDecorator: true, decoratorMetadata: true },
          target: 'es2023',
          keepClassNames: true,
          baseUrl: './',
          paths: { '@/*': ['src/*'] },
        },
        module: { type: 'commonjs' },
      },
    ],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // NestJS 12 ships ESM-only packages (@nestjs/*, rxjs, uid). Jest runs CJS, so
  // those node_modules must go through the same SWC transform as our sources.
  transformIgnorePatterns: ['/node_modules/(?!(.*[.]mjs$|@nestjs/|rxjs/|uid/|@lukeed/|nanoid/))'],
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  collectCoverageFrom: ['src/**/*.(t|j)s'],
  coveragePathIgnorePatterns: ['\\.module\\.ts$', 'main\\.ts$', 'seed\\.ts$'],
  coverageDirectory: './coverage',
  testTimeout: 30000,
  verbose: false,
};
