import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workflowPath = path.resolve(scriptDir, '..', '..', '.github', 'workflows', 'ci.yml');
const workflow = readFileSync(workflowPath, 'utf8').replace(/\r\n/g, '\n');
const deployStart = workflow.indexOf('\n  deploy-prod:');

if (deployStart < 0) throw new Error('deploy-prod job is missing');

const deploy = workflow.slice(deployStart);
const requiredPatterns = [
  [/needs:\s*\[backend, frontend, e2e\]/, 'deploy-prod must depend on backend, frontend, and e2e'],
  [/id:\s*previous[\s\S]*vercel inspect "\$QUANTEDGE_PRODUCTION_URL" --format=json/, 'current production deployment must be captured before deploy'],
  [/id:\s*deploy[\s\S]*vercel deploy --prebuilt --prod/, 'production deployment step is missing'],
  [/if:\s*failure\(\) && steps\.deploy\.outcome == 'success'/, 'rollback must run after a deployed release fails verification'],
  [/vercel rollback "\$previous_url" --timeout=5m/, 'rollback must target the captured production deployment'],
  [/active_host[\s\S]*expected_host[\s\S]*Rollback target mismatch/, 'rollback must verify the active alias target'],
  [/node frontend\/scripts\/smoke-production\.mjs "\$QUANTEDGE_PRODUCTION_URL"/, 'rollback must smoke-test the restored production alias'],
  [/name:\s*Upload rollback record\s*\n\s*if:\s*always\(\)/, 'rollback evidence must be uploaded even when verification fails'],
];

const failures = requiredPatterns
  .filter(([pattern]) => !pattern.test(deploy))
  .map(([, message]) => message);
const vercelConfig = JSON.parse(readFileSync(path.resolve(scriptDir, '..', 'vercel.json'), 'utf8'));
if (vercelConfig.git?.deploymentEnabled !== false) failures.push('Git deployment must not bypass private snapshot preparation and CI gates');
if (!deploy.includes('node frontend/scripts/restore-daily-snapshot.mjs')) failures.push('Production must restore the encrypted daily snapshot before building');

const captureIndex = deploy.indexOf('id: previous');
const deployIndex = deploy.indexOf('id: deploy');
if (captureIndex < 0 || deployIndex < 0 || captureIndex > deployIndex) {
  failures.push('current production deployment must be captured before the new deployment');
}

if (failures.length) {
  throw new Error(`Release workflow gate check failed:\n- ${failures.join('\n- ')}`);
}

console.log('Release workflow gates are enforced.');
