'use strict';

// Jest transformer that runs esbuild on sources it is applied to.
//
// Needed because the Fedify dependency tree contains ESM-only packages
// (e.g. `structured-field-values`) whose `.js` files use `export` syntax.
// Node >=22 can `require()` them natively (the dev server does), but Jest's
// runtime cannot. jest.config.js allowlists those packages via
// `transformIgnorePatterns` so esbuild converts them to CJS here.

const esbuild = require('esbuild');

const loaderFor = (filePath) => {
  if (filePath.endsWith('.ts') || filePath.endsWith('.mts') || filePath.endsWith('.cts'))
    return 'ts';
  if (filePath.endsWith('.jsx')) return 'jsx';
  if (filePath.endsWith('.tsx')) return 'tsx';
  return 'js';
};

module.exports = {
  process(sourceText, sourcePath) {
    const isMjs = sourcePath.endsWith('.mjs');
    const result = esbuild.transformSync(sourceText, {
      loader: isMjs ? 'js' : loaderFor(sourcePath),
      format: 'cjs',
      target: 'node20',
      sourcefile: sourcePath,
      sourcemap: 'inline',
    });
    return { code: result.code };
  },
};
