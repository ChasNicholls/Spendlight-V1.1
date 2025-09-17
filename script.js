// SpendLite V1 (clean wiring) — fixes: defensive event binding, no double listeners, removed obsolete IDs
// Keeps: CSV load, month filter, category totals export, rules import/export, PayPal next-word logic, collapse + pager

const COL = { DATE: 2, DEBIT: 5, LONGDESC: 9 }; // 0-based mapping for 10-col export

let CURRENT_TXNS = [];
let CURRENT_RULES = [];
let CURRENT_FILTER = null; // category filter
let MONTH_FILTER = "";     // 'YYYY-MM' or ''
let CURRENT_PAGE = 1;
const PAGE_SIZE = 10;

function formatMonthLabel(ym) {
  if (!ym) return 'All months';
  const [y, m] = ym.split('-').map(Number);
  const date = new Date(y, m - 1, 1);
  return date.toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

function friendlyMonthOrAll(label) {
  if (!label) return 'All months';
  if (/^\d{4}-\d{2}$/.test(label)) return formatMonthLabel(label);
  return String(label);
}
function forFilename(label) {
  return String(label).replace(/\s+/g, '_');
}

const LS_KEYS = { RULES: 'spendlite_rules_v6626', FILTER: 'spendlite_filter_v6626', MONTH: 'spendlite_month_v6627', TXNS_COLLAPSED: 'spendlite_txns_collapsed_v7', TXNS_JSON: 'spendlite_txns_json_v7' };

function toTitleCase(str) {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b([a-z])/g, (m, p1) => p1.toUpperCase());
}

function parseAmount(s) {
  if (s == null) return 0;
  s = String(s).replace(/[^\d\-,.]/g, '').replace(/,/g, '');
  return Number(s) || 0;
}

function loadCsvText(csvText) {
  const rows = Papa.parse(csvText.trim(), { skipEmptyLines: true }).data;
  const startIdx = rows.length && isNaN(parseAmount(rows[0][COL.DEBIT])) ? 1 : 0;
  const txns = [];
  for (let i = startIdx; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 10) continue;
    const effectiveDate = r[COL.DATE] || '';
    const debit = parseAmount(r[COL.DEBIT]);
    const longDesc = (r[COL.LONGDESC] || '').trim();
    if (!effectiveDate && !longDesc) continue;
    txns.push({ date: effectiveDate, amount: debit, description: longDesc });
  }
  CURRENT_TXNS = txns; saveTxnsToLocalStorage();
  try { updateMonthBanner(); } catch {}
  rebuildMonthDropdown();
  applyRulesAndRender();
  return txns;
}

// --- Date helpers
function parseDateSmart(s) {
  if (!s) return null;
  let d = new Date(s);
  if (!isNaN(d)) return d;

  const m1 = String(s).trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m1) {
    const a = +m1[1], b = +m1[2], y = +m1[3];
    const day = a > 12 ? a : b > 12 ? b : a; // prefer AU
    const month = a > 12 ? b : a;            // prefer AU
    return new Date(y, month - 1, day);
  }

  const s2 = String(s).replace(/^\d{1,2}:\d{2}\s*(am|pm)\s*/i, '');
  const m2 = s2.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)?\s*(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December),?\s+(\d{4})/i);
  if (m2) {
    const day = parseInt(m2[2], 10);
    const monthName = m2[3].toLowerCase();
    const y = parseInt(m2[4], 10);
    const monthMap = {january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,september:8,october:9,november:10,december:11};
    const mi = monthMap[monthName];
    if (mi != null) return new Date(y, mi, day);
  }
  return null;
}
function yyyymm(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }

function getFirstTxnMonth(txns = CURRENT_TXNS) {
  if (!txns.length) return null;
  const d = parseDateSmart(txns[0].date);
  if (!d || isNaN(d)) return null;
  return yyyymm(d);
}

// Build month list for dropdown
function rebuildMonthDropdown() {
  const sel = document.getElementById('monthFilter');
  if (!sel) return;
  const months = new Set();
  for (const t of CURRENT_TXNS) {
    const d = parseDateSmart(t.date);
    if (d) months.add(yyyymm(d));
  }
  const list = Array.from(months).sort(); // ascending
  const current = MONTH_FILTER;
  sel.innerHTML = `<option value="">All months</option>` + list.map(m => `<option value="${m}">${formatMonthLabel(m)}</option>`).join('');
  sel.value = current && list.includes(current) ? current : "";
  updateMonthBanner();
}

function monthFilteredTxns() {
  if (!MONTH_FILTER) return CURRENT_TXNS;
  return CURRENT_TXNS.filter(t => {
    const d = parseDateSmart(t.date);
    return d && yyyymm(d) === MONTH_FILTER;
  });
}

function parseRules(text) {
  const lines = String(text || "").split(/\r?\n/);
  const rules = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(/=>/i);
    if (parts.length >= 2) {
      const keyword = parts[0].trim().toLowerCase();
      const category = parts[1].trim().toUpperCase();
      if (keyword && category) rules.push({ keyword, category });
    }
  }
  return rules;
}

function categorise(txns, rules) {
  for (const t of txns) {
    const desc = t.description.toLowerCase();
    let matched = 'UNCATEGORISED';
    for (const r of rules) {
      if (desc.includes(r.keyword)) { matched = r.category; break; }
    }
    t.category = matched;
  }
  return txns;
}

function computeCategoryTotals(txns) {
  const byCat = new Map();
  for (const t of txns) {
    const cat = (t.category || 'UNCATEGORISED').toUpperCase();
    byCat.set(cat, (byCat.get(cat) || 0) + t.amount);
  }
  const rows = [...byCat.entries()].sort((a,b) => b[1]-a[1]);
  const grand = rows.reduce((acc, [,v]) => acc + v, 0);
  return { rows, grand };
}

function renderCategoryTotals(txns) {
  const { rows, grand } = computeCategoryTotals(txns);
  const totalsDiv = document.getElementById('categoryTotals');
  if (!totalsDiv) return;
  let html = '<table class="cats"><colgroup><col class="col-cat"><col class="col-total"><col class="col-pct"></colgroup><thead><tr><th>Category</th><th class="num">Total</th><th class="num">%</th></tr></thead><tbody>';
  for (const [cat, total] of rows) {
    html += `<tr>
      <td><a class="catlink" data-cat="${escapeHtml(cat)}"><span class="category-name">${escapeHtml(toTitleCase(cat))}</span></a></td>
      <td class="num">${total.toFixed(2)}</td><td class="num">${(grand ? (total / grand * 100) : 0).toFixed(1)}%</td>
    </tr>`;
  }
  html += `</tbody><tfoot><tr><td>Total</td><td class="num">${grand.toFixed(2)}</td><td class="num">100%</td></tr></tfoot></table>`;
  totalsDiv.innerHTML = html;

  totalsDiv.querySelectorAll('a.catlink').forEach(a => {
    a.addEventListener('click', () => {
      CURRENT_FILTER = a.getAttribute('data-cat');
      try { localStorage.setItem(LS_KEYS.FILTER, CURRENT_FILTER || ''); } catch {}
      updateFilterUI(); CURRENT_PAGE = 1;
      renderTransactionsTable();
    });
  });
}

function renderMonthTotals() {
  const txns = getFilteredTxns(monthFilteredTxns());
  let debit = 0, credit = 0, count = 0;
  for (const t of txns) {
    const amt = Number(t.amount) || 0;
    if (amt > 0) debit += amt; else credit += Math.abs(amt);
    count++;
  }
  const net = debit - credit;
  const el = document.getElementById('monthTotals');
  if (el) {
    const cat = CURRENT_FILTER ? ` + category "${CURRENT_FILTER}"` : "";
    el.innerHTML = `Showing <span class="badge">${count}</span> transactions for <strong>${friendlyMonthOrAll(MONTH_FILTER)}${cat}</strong> · ` +
                   `Debit: <strong>$${debit.toFixed(2)}</strong> · ` +
                   `Credit: <strong>$${credit.toFixed(2)}</strong> · ` +
                   `Net: <strong>$${net.toFixed(2)}</strong>`;
  }
}

function applyRulesAndRender() {
  CURRENT_PAGE = 1;
  const box = document.getElementById('rulesBox');
  CURRENT_RULES = parseRules(box ? box.value : '');
  try { localStorage.setItem(LS_KEYS.RULES, box ? box.value : ''); } catch {}
  const txns = monthFilteredTxns();
  categorise(txns, CURRENT_RULES);
  renderMonthTotals();
  renderCategoryTotals(txns);
  renderTransactionsTable(txns);
  renderTotalsBar(txns);
  saveTxnsToLocalStorage();
  try { updateMonthBanner(); } catch {}
}

function computeDebitCredit(txns) {
  let sumDebit = 0, sumCredit = 0;
  for (const t of txns) {
    if (t.amount > 0) sumDebit += t.amount;
    else sumCredit += Math.abs(t.amount);
  }
  return {sumDebit, sumCredit, net: sumDebit - sumCredit};
}

function renderTotalsBar(txns) {
  const {sumDebit, sumCredit, net} = computeDebitCredit(txns);
  const el = document.getElementById('totalsBar');
  if (!el) return;
  const monthLabel = friendlyMonthOrAll(MONTH_FILTER);
  el.innerHTML = `Rows: <strong>${txns.length}</strong> · Debit: <strong>$${sumDebit.toFixed(2)}</strong> · Credit: <strong>$${sumCredit.toFixed(2)}</strong> · Net: <strong>$${net.toFixed(2)}</strong> (${monthLabel})`;
}

function exportTotals() {
  const txns = monthFilteredTxns();
  const { rows, grand } = computeCategoryTotals(txns);
  const label = friendlyMonthOrAll(MONTH_FILTER || getFirstTxnMonth(txns) || new Date());
  const header = `SpendLite Category Totals (${label})`;

  const catWidth = Math.max(8, ...rows.map(([cat]) => toTitleCase(cat).length), 'Category'.length);
  const amtWidth = 12;
  const pctWidth = 6;

  const lines = [];
  lines.push(header);
  lines.push('='.repeat(header.length));
  lines.push('Category'.padEnd(catWidth) + ' ' + 'Amount'.padStart(amtWidth) + ' ' + '%'.padStart(pctWidth));

  for (const [cat, total] of rows) {
    const pct = grand ? (total / grand * 100) : 0;
    lines.push(toTitleCase(cat).padEnd(catWidth) + ' ' + total.toFixed(2).padStart(amtWidth) + ' ' + (pct.toFixed(1) + '%').padStart(pctWidth));
  }
  lines.push('');
  lines.push('TOTAL'.padEnd(catWidth) + ' ' + grand.toFixed(2).padStart(amtWidth) + ' ' + '100%'.padStart(pctWidth));

  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `category_totals_${forFilename(label)}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// --- helper: get next word after a marker (e.g., "paypal")
function nextWordAfter(marker, desc) {
  const lower = (desc || '').toLowerCase();
  const i = lower.indexOf(String(marker).toLowerCase());
  if (i === -1) return '';
  let after = (desc || '').slice(i + String(marker).length).replace(/^[\s\-:\/*]+/, '');
  const m = after.match(/^([A-Za-z0-9&._]+)/);
  return m ? m[1] : '';
}

function assignCategory(idx) {
  const txn = CURRENT_TXNS[idx];
  if (!txn) return;
  const desc = txn.description || "";
  const up = desc.toUpperCase();

  let suggestedKeyword = "";
  if (/\bPAYPAL\b/.test(up)) {
    const nxt = nextWordAfter('paypal', desc);
    suggestedKeyword = ('PAYPAL' + (nxt ? ' ' + nxt : '')).toUpperCase();
  } else {
    const visaPos = up.indexOf("VISA-");
    if (visaPos !== -1) {
      const after = desc.substring(visaPos + 5).trim();
      suggestedKeyword = (after.split(/\s+/)[0] || "").toUpperCase();
    } else {
      suggestedKeyword = (desc.split(/\s+/)[0] || "").toUpperCase();
    }
  }

  const keywordInput = prompt("Enter keyword to match:", suggestedKeyword);
  if (!keywordInput) return;
  const keyword = keywordInput.trim().toUpperCase();

  const defaultCat = (txn.category || "UNCATEGORISED").toUpperCase();
  const catInput = prompt("Enter category name:", defaultCat);
  if (!catInput) return;
  const category = catInput.trim().toUpperCase();

  const box = document.getElementById('rulesBox');
  const lines = String(box ? box.value : "").split(/\\r?\\n/);
  let updated = false;
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] || "").trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/=>/i);
    if (parts.length >= 2) {
      const k = parts[0].trim().toUpperCase();
      if (k === keyword) {
        lines[i] = `${keyword} => ${category}`;
        updated = true;
        break;
      }
    }
  }
  if (!updated) lines.push(`${keyword} => ${category}`);
  if (box) box.value = lines.join("\\n");
  try { localStorage.setItem(LS_KEYS.RULES, box ? box.value : ''); } catch {}
  if (typeof applyRulesAndRender === 'function') applyRulesAndRender();
}

// Import/export rules
function exportRules() {
  const text = (document.getElementById('rulesBox')?.value) || '';
  const blob = new Blob([text], {type: 'text/plain'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'rules.txt'; // unified filename
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function importRulesFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const text = reader.result || '';
    const box = document.getElementById('rulesBox');
    if (box) box.value = text;
    applyRulesAndRender();
  };
  reader.readAsText(file);
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

// ---------- Safe event wiring ----------
function bind(id, evt, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(evt, handler);
  // else console.warn('Skipped binding: #' + id);
}

document.addEventListener('DOMContentLoaded', () => {
  // Wiring
  bind('csvFile', 'change', (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { loadCsvText(reader.result); };
    reader.readAsText(file);
  });
  bind('exportTotalsBtn', 'click', exportTotals);
  bind('exportRulesBtn', 'click', exportRules);
  bind('importRulesBtn', 'click', () => document.getElementById('importRulesInput')?.click());
  bind('importRulesInput', 'change', (e) => {
    const f = e.target.files && e.target.files[0]; if (f) importRulesFromFile(f);
  });
  bind('clearFilterBtn', 'click', () => {
    CURRENT_FILTER = null; try { localStorage.removeItem(LS_KEYS.FILTER); } catch {}
    updateFilterUI(); CURRENT_PAGE = 1; renderTransactionsTable(); renderMonthTotals(monthFilteredTxns());
  });
  bind('clearMonthBtn', 'click', () => {
    MONTH_FILTER = ""; try { localStorage.removeItem(LS_KEYS.MONTH); } catch {}
    const sel = document.getElementById('monthFilter'); if (sel) sel.value = "";
    updateMonthBanner();
    CURRENT_PAGE = 1;
    applyRulesAndRender();
  });
  bind('monthFilter', 'change', (e) => {
    MONTH_FILTER = e.target.value || "";
    try { localStorage.setItem(LS_KEYS.MONTH, MONTH_FILTER); } catch {}
    updateMonthBanner();
    CURRENT_PAGE = 1;
    applyRulesAndRender();
  });

  // Restore rules
  let restored = false;
  try {
    const saved = localStorage.getItem(LS_KEYS.RULES);
    if (saved && saved.trim()) { const box = document.getElementById('rulesBox'); if (box) box.value = saved; restored = true; }
  } catch {}
  if (!restored) {
    try { fetch('rules.txt').then(r => r.text()).then(text => { const box = document.getElementById('rulesBox'); if (box) box.value = text; applyRulesAndRender(); }); restored = true; } catch {}
  }
  if (!restored) {
    const box = document.getElementById('rulesBox');
    if (box) box.value = SAMPLE_RULES;
  }

  // Restore filters
  try { const savedFilter = localStorage.getItem(LS_KEYS.FILTER); CURRENT_FILTER = savedFilter && savedFilter.trim() ? savedFilter.toUpperCase() : null; } catch {}
  try { const savedMonth = localStorage.getItem(LS_KEYS.MONTH); MONTH_FILTER = savedMonth || ""; } catch {}

  updateFilterUI(); CURRENT_PAGE = 1;
  updateMonthBanner();
  applyTxnsCollapsedUI();
  renderTotalsBar(monthFilteredTxns());
});

const SAMPLE_RULES = `# Rules format: KEYWORD => CATEGORY
OFFICEWORKS => OFFICE SUPPLIES
COLES => GROCERIES
SHELL => PETROL
UBER => TRANSPORT
WOOLWORTHS => GROCERIES
BP => PETROL
BUNNINGS => HARDWARE
`;

// --- Transactions collapse logic ---
function isTxnsCollapsed() {
  try { return localStorage.getItem(LS_KEYS.TXNS_COLLAPSED) !== 'false'; } catch { return true; }
}
function setTxnsCollapsed(v) {
  try { localStorage.setItem(LS_KEYS.TXNS_COLLAPSED, v ? 'true' : 'false'); } catch {}
}
function applyTxnsCollapsedUI() {
  const body = document.getElementById('transactionsBody');
  const toggle = document.getElementById('txnsToggleBtn');
  const collapsed = isTxnsCollapsed();
  if (body) body.style.display = collapsed ? 'none' : '';
  if (toggle) toggle.textContent = collapsed ? 'Show transactions' : 'Hide transactions';
}
function toggleTransactions() {
  const collapsed = isTxnsCollapsed();
  setTxnsCollapsed(!collapsed);
  applyTxnsCollapsedUI();
}

function renderTransactionsTable(txns = monthFilteredTxns()) {
  const filtered = getFilteredTxns(txns);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (CURRENT_PAGE > totalPages) CURRENT_PAGE = totalPages;
  if (CURRENT_PAGE < 1) CURRENT_PAGE = 1;
  const start = (CURRENT_PAGE - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);
  const table = document.getElementById('transactionsTable');
  if (!table) return;
  let html = '<tr><th>Date</th><th>Amount</th><th>Category</th><th>Description</th><th></th></tr>';
  pageItems.forEach((t) => {
    const idx = CURRENT_TXNS.indexOf(t);
    const cat = (t.category || 'UNCATEGORISED').toUpperCase();
    html += `<tr>
      <td>${escapeHtml(t.date)}</td>
      <td>${t.amount.toFixed(2)}</td>
      <td><span class="category-name">${escapeHtml(toTitleCase(cat))}</span></td>
      <td>${escapeHtml(t.description)}</td>
      <td><button class="rule-btn" onclick="assignCategory(${idx})">+</button></td>
    </tr>`;
  });
  table.innerHTML = html;
  renderPager(totalPages);
}

function getFilteredTxns(txns) {
  if (!CURRENT_FILTER) return txns;
  return txns.filter(t => (t.category || 'UNCATEGORISED').toUpperCase() === CURRENT_FILTER);
}

function updateFilterUI() {
  const label = document.getElementById('activeFilter');
  const btn = document.getElementById('clearFilterBtn');
  if (label) label.textContent = CURRENT_FILTER ? `— filtered by "${CURRENT_FILTER}"` : '';
  if (btn) btn.style.display = CURRENT_FILTER ? '' : 'none';
}

function updateMonthBanner() {
  const banner = document.getElementById('monthBanner');
  const label = friendlyMonthOrAll(MONTH_FILTER);
  if (banner) banner.textContent = `— ${label}`;
}

function renderPager(totalPages) {
  const pager = document.getElementById('pager');
  if (!pager) return;
  const pages = totalPages || 1;
  const cur = CURRENT_PAGE;

  function pageButton(label, page, disabled=false, isActive=false) {
    const disAttr = disabled ? ' disabled' : '';
    const activeClass = isActive ? ' active' : '';
    return `<button class="page-btn${activeClass}" data-page="${page}"${disAttr}>${label}</button>`;
  }

  const windowSize = 5;
  let start = Math.max(1, cur - Math.floor(windowSize/2));
  let end = Math.min(pages, start + windowSize - 1);
  start = Math.max(1, Math.min(start, end - windowSize + 1));

  let html = '';
  html += pageButton('First', 1, cur === 1);
  html += pageButton('Prev', Math.max(1, cur - 1), cur === 1);

  for (let p = start; p <= end; p++) {
    html += pageButton(String(p), p, false, p === cur);
  }

  html += pageButton('Next', Math.min(pages, cur + 1), cur === pages);
  html += pageButton('Last', pages, cur === pages);
  html += `<span style="margin-left:8px">Page ${cur} / ${pages}</span>`;

  pager.innerHTML = html;
  pager.querySelectorAll('button.page-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const page = Number(e.currentTarget.getAttribute('data-page'));
      if (!page || page === CURRENT_PAGE) return;
      CURRENT_PAGE = page;
      renderTransactionsTable();
    });
  });

  // Wheel to flip pages
  const table = document.getElementById('transactionsTable');
  if (table && !table._wheelBound) {
    table.addEventListener('wheel', (e) => {
      if (pages <= 1) return;
      if (e.deltaY > 0 && CURRENT_PAGE < pages) { CURRENT_PAGE++; renderTransactionsTable(); }
      else if (e.deltaY < 0 && CURRENT_PAGE > 1) { CURRENT_PAGE--; renderTransactionsTable(); }
    }, { passive: true });
    table._wheelBound = true;
  }
}

function saveTxnsToLocalStorage(){
  try {
    const data = JSON.stringify(CURRENT_TXNS||[]);
    localStorage.setItem(LS_KEYS.TXNS_JSON, data);
    // mirror-save to standard keys for Advanced mode
    localStorage.setItem('spendlite_txns_json_v7', data);
    localStorage.setItem('spendlite_txns_json', data);
  } catch {}
}

// Save transactions before leaving (safety net when switching to Advanced)
window.addEventListener('beforeunload', () => {
  try { localStorage.setItem(LS_KEYS.TXNS_JSON, JSON.stringify(CURRENT_TXNS||[])); } catch {}
});
