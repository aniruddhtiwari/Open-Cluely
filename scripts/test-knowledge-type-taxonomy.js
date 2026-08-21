const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const chatHtml = fs.readFileSync(path.join(__dirname, '..', 'chat.html'), 'utf8');
const selectMatch = chatHtml.match(/<select[^>]+id="knowledgeEvidenceType"[^>]*>([\s\S]*?)<\/select>/);

assert.ok(selectMatch, 'Knowledge Type selector should exist');

const options = [...selectMatch[1].matchAll(/<option\s+value="([^"]+)"([^>]*)>([^<]+)<\/option>/g)]
  .map(match => ({
    value: match[1],
    label: match[3].trim(),
    selected: /\bselected\b/.test(match[2])
  }));

assert.deepEqual(options, [
  { value: 'candidate', label: 'My Context', selected: true },
  { value: 'job', label: 'Requirements', selected: false },
  { value: 'reference', label: 'Reference', selected: false }
]);

assert.match(chatHtml, /candidate:\s*'My Context'/);
assert.match(chatHtml, /job:\s*'Requirements'/);
assert.match(chatHtml, /reference:\s*'Reference'/);
assert.match(chatHtml, /unknown:\s*'Reference'/);
assert.match(chatHtml, /knowledgeEvidenceType\s*\?\s*knowledgeEvidenceType\.value\s*:\s*'candidate'/);
assert.match(chatHtml, /:\s*'candidate';\s*\n\s*}/);

console.log('Knowledge Type taxonomy assertions passed.');
