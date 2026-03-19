/**
 * Playwright global teardown — runs once after all test files complete.
 *
 * PGlite is in-memory so there is no persistent state to clean.
 * This teardown logs a summary and can be extended if file-based
 * cleanup is ever needed (e.g. uploaded assets, temp files).
 */

export default async function globalTeardown() {
  console.log('\n[global-teardown] Test run complete. PGlite DB discarded (in-memory).')
}
