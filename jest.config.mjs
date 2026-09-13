export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)', '**/?(*.)+(spec|test).mjs'],
  moduleFileExtensions: ['js', 'mjs', 'json', 'node'],
  transform: {},
};
