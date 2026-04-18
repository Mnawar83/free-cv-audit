#!/usr/bin/env node
const { execSync } = require('child_process');

try {
  execSync('node --check netlify/functions/*.js', { stdio: 'inherit' });
  execSync('node --check netlify/functions/utils/*.js', { stdio: 'inherit' });
  execSync('node --check scripts/*.js', { stdio: 'inherit' });
} catch (error) {
  process.exit(error.status || 1);
}
