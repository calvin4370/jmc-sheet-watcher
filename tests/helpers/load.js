// Loads every src/**/*.js file into the test process's global scope, the same way
// Apps Script shares one global scope across files.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const srcDir = path.join(__dirname, '..', '..', 'src');

function listJs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((e) => (e.isDirectory() ? listJs(path.join(dir, e.name))
      : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));
}

for (const file of listJs(srcDir)) {
  vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: path.relative(srcDir, file) });
}

module.exports = globalThis;
