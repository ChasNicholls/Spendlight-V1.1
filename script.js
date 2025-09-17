// SpendLite script.js with newline handling fixes
// Added .replace(/\\n/g, '\n') when loading rules
// Normalized line endings when saving/exporting rules

function importRulesFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const text = reader.result || '';
    const box = document.getElementById('rulesBox');
    if (box) box.value = text.replace(/\\n/g, '\n');
    applyRulesAndRender();
  };
  reader.readAsText(file);
}

function exportRules() {
  const text = (document.getElementById('rulesBox')?.value || '').replace(/\r?\n/g, '\n');
  const blob = new Blob([text], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'rules.txt';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// assignCategory join uses real newlines
function assignCategory(idx) {
  // ... existing logic ...
  if (!updated) lines.push(`${keyword} => ${category}`);
  if (box) box.value = lines.join('\n');
  try { localStorage.setItem(LS_KEYS.RULES, box ? box.value : ''); } catch {}
  if (typeof applyRulesAndRender === 'function') applyRulesAndRender();
}
