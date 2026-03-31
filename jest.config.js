module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/src/renderer/setupTests.ts'],
  moduleNameMapper: {
    '^@xterm/xterm$': '<rootDir>/node_modules/@xterm/xterm/lib/xterm.js',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
    }],
  },
};
