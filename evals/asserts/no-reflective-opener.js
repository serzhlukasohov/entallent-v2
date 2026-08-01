const path = require('path');
const { hasReflectiveOpener } = require(
  path.resolve(__dirname, '../../packages/ai-openai/dist/index.js')
);
// promptfoo file-based javascript assert: receives the model output string.
module.exports = (output) => {
  let text = '';
  try { text = JSON.parse(output).text || ''; } catch { text = output || ''; }
  return hasReflectiveOpener(text)
    ? { pass: false, score: 0, reason: 'Opens with a reflective label: ' + text.slice(0, 60) }
    : { pass: true, score: 1, reason: 'ok' };
};
