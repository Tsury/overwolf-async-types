#!/usr/bin/env node
const { exec } = require('child_process');

exec('npm run build', { cwd: __dirname }, (error, stdout, stderr) => {
  console.log(stdout);
  console.error(stderr);
});