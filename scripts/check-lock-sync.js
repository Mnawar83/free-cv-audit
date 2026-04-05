const fs = require('fs');
const path = require('path');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

const root = process.cwd();
const packageJson = readJson(path.join(root, 'package.json'));
const packageLock = readJson(path.join(root, 'package-lock.json'));

const pkgDeps = packageJson.dependencies || {};
const lockRootDeps = packageLock?.packages?.['']?.dependencies || {};

const missing = [];
const mismatched = [];

for (const [dep, version] of Object.entries(pkgDeps)) {
  if (!(dep in lockRootDeps)) {
    missing.push(dep);
    continue;
  }
  if (lockRootDeps[dep] !== version) {
    mismatched.push({ dep, packageJson: version, packageLock: lockRootDeps[dep] });
  }
}

if (missing.length || mismatched.length) {
  console.error('Dependency lock sync check failed.');
  if (missing.length) {
    console.error(`Missing in package-lock root dependencies: ${missing.join(', ')}`);
  }
  if (mismatched.length) {
    for (const item of mismatched) {
      console.error(`Version mismatch for ${item.dep}: package.json=${item.packageJson}, package-lock.json=${item.packageLock}`);
    }
  }
  process.exit(1);
}

console.log('Dependency lock sync check passed.');
