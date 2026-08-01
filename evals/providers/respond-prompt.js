// promptfoo prompt function: renders the REAL production respond prompt from test vars,
// so evals exercise buildRespondSystemPrompt/buildRespondUserPrompt, not a stub.
const path = require('path');
const { buildRespondSystemPrompt, buildRespondUserPrompt } = require(
  path.resolve(__dirname, '../../packages/ai-openai/dist/index.js')
);

module.exports = async function ({ vars }) {
  const strategy = vars.strategy || {
    mode: 'normal', tone: 'warm', includeFollowUpQuestion: true,
    maxResponseLength: 'medium', forbiddenPatterns: [],
  };
  const context = vars.context || { userName: vars.userName || 'there' };
  const turns = (vars.turns || []).map((t) => ({
    role: t.role, content: t.content, timestamp: new Date(),
  }));
  return [
    { role: 'system', content: buildRespondSystemPrompt(strategy, context) },
    { role: 'user', content: buildRespondUserPrompt(turns, context) },
  ];
};
