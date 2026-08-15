#!/usr/bin/env node
/**
 * Replicates the static checks the Homebridge verification bot runs
 * (homebridge/plugins, src/plugin-checks/workspace/index.ts) against the local
 * working tree, so a verification request is not a shot in the dark.
 *
 * The bot's runtime scenarios (start with no config / platform only / minimal /
 * full config, network failures, SIGTERM) are covered by scripts/verify.sh
 * against the real Homebridge containers.
 *
 * Run from the repo root or dev-env: node dev-env/scripts/verification-preflight.mjs
 */
import { execSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, existsSync } from 'node:fs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(join(root, 'package.json'))

const passed = []
const failed = []
const warned = []
const pass = m => passed.push(m)
const fail = m => failed.push(m)
const warn = m => warned.push(m)

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

// --- Package JSON checks (bot: testPackageJson) -----------------------------------------

pkg.homepage?.startsWith('https://')
  ? pass('package.json: homepage exists and is https')
  : fail('package.json: homepage missing or not https')

pkg.bugs?.url?.startsWith('https://')
  ? pass('package.json: bugs.url exists and is https')
  : fail('package.json: bugs.url missing or not https')

const keywords = pkg.keywords ?? []
keywords.includes('homebridge-plugin') && keywords.length > 1
  ? pass('package.json: keywords contain homebridge-plugin plus others')
  : fail('package.json: keywords must contain homebridge-plugin and more')

keywords.includes('supports-hap') || keywords.includes('supports-matter')
  ? pass('package.json: keywords declare a supported transport')
  : fail('package.json: keywords must include supports-hap and/or supports-matter')

for (const script of ['preinstall', 'install', 'postinstall']) {
  pkg.scripts?.[script]
    ? fail(`package.json: '${script}' script is not allowed`)
    : pass(`package.json: no '${script}' script`)
}

// Engines vs current Node LTS lines and latest Homebridge, like the bot does.
const semver = require('semver')
for (const [label, probe] of [['Node 22', '22.99.0'], ['Node 24', '24.99.0']]) {
  semver.satisfies(probe, pkg.engines?.node ?? '', { includePrerelease: true })
    ? pass(`package.json: engines.node compatible with ${label}`)
    : fail(`package.json: engines.node NOT compatible with ${label}`)
}
const latestHb = execSync('npm view homebridge version', { encoding: 'utf8' }).trim()
semver.satisfies(latestHb, pkg.engines?.homebridge ?? '')
  ? pass(`package.json: engines.homebridge compatible with Homebridge ${latestHb}`)
  : fail(`package.json: engines.homebridge NOT compatible with Homebridge ${latestHb}`)

// --- Dependency checks (bot: testDependencies) ------------------------------------------

for (const dep of ['homebridge', 'hap-nodejs']) {
  const anywhere = ['dependencies', 'optionalDependencies', 'bundledDependencies', 'peerDependencies']
    .some(field => pkg[field]?.[dep])
  anywhere
    ? fail(`dependencies: ${dep} must only be a devDependency`)
    : pass(`dependencies: ${dep} not a runtime/peer/bundled dependency`)
}

// --- Security (bot: testSecurityVulnerabilities) ----------------------------------------

try {
  const audit = JSON.parse(execSync('npm audit --omit=dev --json', { cwd: root, encoding: 'utf8' }))
  const { critical = 0, high = 0 } = audit.metadata?.vulnerabilities ?? {}
  critical > 0
    ? fail(`security: ${critical} critical vulnerabilities`)
    : pass('security: no critical vulnerabilities')
  if (high > 0) warn(`security: ${high} high vulnerabilities (bot flags for manual review)`)
} catch (e) {
  // npm audit exits non-zero when there are findings; parse its stdout anyway.
  try {
    const audit = JSON.parse(e.stdout)
    const { critical = 0, high = 0 } = audit.metadata?.vulnerabilities ?? {}
    critical > 0
      ? fail(`security: ${critical} critical vulnerabilities`)
      : pass('security: no critical vulnerabilities')
    if (high > 0) warn(`security: ${high} high vulnerabilities (bot flags for manual review)`)
  } catch {
    fail('security: npm audit could not be run')
  }
}

// --- Code safety patterns (bot: testCodeSafety, on the shipped files) -------------------

const shipped = execSync('npm pack --dry-run --json', { cwd: root, encoding: 'utf8' })
const files = JSON.parse(shipped)[0].files.map(f => f.path).filter(p => /\.(js|mjs|cjs)$/.test(p))
const dangerous = [
  [/\beval\s*\(/, 'eval()'],
  [/new\s+Function\s*\(/, 'new Function()'],
  [/child_process/, 'child_process'],
  [/\.ssh[/\\]/, 'SSH directory access'],
  [/\/etc\/passwd/, '/etc/passwd access'],
  [/\bid_rsa\b/, 'SSH key access'],
]
let dirty = false
for (const file of files) {
  const content = readFileSync(join(root, file), 'utf8')
  for (const [re, label] of dangerous) {
    if (re.test(content)) { warn(`code safety: ${label} in ${file} (bot flags for manual review)`); dirty = true }
  }
}
if (!dirty) pass('code safety: no dangerous patterns in the published files')

// --- Config schema (bot: testConfigSchema) ----------------------------------------------

const schemaPath = join(root, 'config.schema.json')
if (!existsSync(schemaPath)) {
  fail('config.schema.json: missing')
} else {
  const configSchema = JSON.parse(readFileSync(schemaPath, 'utf8'))
  pass('config.schema.json: exists and is valid JSON')

  configSchema.pluginAlias
    ? pass('config.schema.json: has pluginAlias')
    : fail('config.schema.json: pluginAlias missing')
  configSchema.pluginType === 'platform'
    ? pass('config.schema.json: pluginType is platform')
    : fail('config.schema.json: pluginType is not platform')
  configSchema.schema?.properties?.name
    ? pass('config.schema.json: has a name schema property')
    : fail('config.schema.json: name schema property missing')

  // The bot compiles the schema with Ajv draft-07; `"required": true` on a property fails.
  const Ajv = require('ajv')
  try {
    new Ajv({ strict: false, allErrors: true }).compile(configSchema.schema)
    pass('config.schema.json: compiles as draft-07 JSON Schema (Ajv)')
  } catch (e) {
    fail(`config.schema.json: Ajv rejects the schema - ${e.message}`)
  }

  // pluginAlias must match what the code registers.
  const settings = readFileSync(join(root, 'src/settings.ts'), 'utf8')
  const match = settings.match(/PLATFORM_NAME\s*=\s*'([^']+)'/)
  match && match[1] === configSchema.pluginAlias
    ? pass('config.schema.json: pluginAlias matches PLATFORM_NAME in code')
    : fail('config.schema.json: pluginAlias does not match the registered platform name')
}

// --- Version sync (bot: testGitHubVersionSync) ------------------------------------------

try {
  const npmVersion = execSync(`npm view ${pkg.name} version`, { encoding: 'utf8' }).trim()
  npmVersion === pkg.version
    ? pass(`version sync: npm (${npmVersion}) matches package.json (${pkg.version})`)
    : warn(`version sync: npm has ${npmVersion}, package.json has ${pkg.version} - `
      + 'the bot FAILS this until the new version is published to npm AND pushed to the default branch')
} catch {
  warn('version sync: package not on npm yet (bot skips in that case)')
}

// --- Report -----------------------------------------------------------------------------

for (const m of passed) console.log(`  PASS ${m}`)
for (const m of warned) console.log(`  WARN ${m}`)
for (const m of failed) console.log(`  FAIL ${m}`)
console.log(`\n${passed.length} passed, ${warned.length} warnings, ${failed.length} failed`)
process.exit(failed.length ? 1 : 0)
