// SpendLite script.js with CSV loading and newline handling fixes
// Ensure Papa Parse is included in your HTML for CSV parsing

const COL = { DATE: 2, DEBIT: 5, LONGDESC: 9 };
let CURRENT_TXNS = [];
let CURRENT_RULES = [];
let CURRENT_FILTER = null;
let MONTH_FILTER = "";
let CURRENT_PAGE = 1;
const PAGE_SIZE = 10;

function parseAmount(s) {
  if (s == null) return 0;
  s = String(s).replace(/[^\d\-,.]/g, '').replace(/,/g, '');
  return Number(s) || 0;
}

function loadCsvText(csvText) {
  if (typeof Papa === 'undefined') {
    alert('Papa Parse not found. Include papaparse.min.js in your HTML.');
    return [];
  }
  const rows = Papa.parse(csvText.trim(), { skipEmptyLines: true }).data;
  const startIdx = rows.length && isNaN(parseAmount(rows[0][COL.DEBIT])) ? 1 : 0;
  const txns = [];
  for (let i = startIdx; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 10) continue;
    const date = r[COL.DATE] || '';
    const debit = parseAmount(r[COL.DEBIT]);
    const desc = (r[COL.LONGDESC] || '').trim();
    if (!date && !desc) continue;
    txns.push({ date, amount: debit, description: desc });
  }
  CURRENT_TXNS = txns;
  applyRulesAndRender();
  return txns;
}

function parseRules(text) {
  const normalized = String(text || "").replace(/\\n/g, '\n');
  const lines = normalized.split(/\r?\n/);
  const rules = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(/=>/i);
    if (parts.length >= 2) {
      const keyword = parts[0].trim().toLowerCase();
      const category = parts[1].trim().toUpperCase();
      rules.push({ keyword, category });
    }
  }
  return rules;
}

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
  const raw = (document.getElementById('rulesBox')?.value) || '';
  const text = raw.replace(/\r?\n/g, '\n');
  const blob = new Blob([text], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'rules.txt';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function assignCategory(idx) {
  const txn = CURRENT_TXNS[idx];
  if (!txn) return;
  const keyword = prompt("Enter keyword to match:", txn.description.split(' ')[0] || '').toUpperCase();
  const category = prompt("Enter category name:", txn.category || 'UNCATEGORISED').toUpperCase();
  const box = document.getElementById('rulesBox');
  const lines = String(box?.value || "").split(/\r?\n/);
  lines.push(`${keyword} => ${category}`);
  if (box) box.value = lines.join('\n');
  applyRulesAndRender();
}

document.addEventListener('DOMContentLoaded', () => {
  const csvInput = document.getElementById('csvFile');
  if (csvInput) {
    csvInput.addEventListener('change', e => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => loadCsvText(reader.result);
      reader.readAsText(file);
    });
  }
  const exportBtn = document.getElementById('exportRulesBtn');
  if (exportBtn) exportBtn.addEventListener('click', exportRules);
  const importBtn = document.getElementById('importRulesBtn');
  if (importBtn) importBtn.addEventListener('click', () => document.getElementById('importRulesInput')?.click());
  const importInput = document.getElementById('importRulesInput');
  if (importInput) {
    importInput.addEventListener('change', e => {
      const f = e.target.files?.[0];
      if (f) importRulesFromFile(f);
    });
  }
});

function applyRulesAndRender() {
  const box = document.getElementById('rulesBox');
  CURRENT_RULES = parseRules(box ? box.value : '');
  // Rendering logic placeholder
  console.log('Applied rules to', CURRENT_TXNS.length, 'transactions');
}
