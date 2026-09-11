const CHAIN_COLORS = { shufersal: '#d6455b', rami_levy: '#1a9e6f', carrefour: '#2f6fd0' };
const fmt = n => '₪' + n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let DATA = null;
const qty = {}; // item id -> quantity

let ENRICH = {};
async function boot() {
  DATA = await (await fetch('data/index.json')).json();
  const basket = await (await fetch('data/basket.json')).json();
  basket.items.forEach(b => { ENRICH[b.barcode] = b; });
  DATA.latest.items.forEach(it => { qty[it.id] = 1; });
  initReceipt();
  renderTotals();
  renderChart();
  renderCalc();
  document.getElementById('selectAll').onclick = () => { DATA.latest.items.forEach(it => qty[it.id] = 1); syncCalc(); };
  document.getElementById('selectNone').onclick = () => { DATA.latest.items.forEach(it => qty[it.id] = 0); syncCalc(); };
}

function chainKeys() { return Object.keys(DATA.latest.totals); }

function renderTotals() {
  const t = DATA.latest.totals;
  const cheapest = chainKeys().sort((a, b) => t[a] - t[b])[0];
  const el = document.getElementById('totals');
  el.innerHTML = chainKeys().map(k => `
    <div class="total-chip ${k === cheapest ? 'cheapest' : ''}">
      <div class="chain">${DATA.latest.chains[k].name_he}${k === cheapest ? ' <span class="badge">הכי זול</span>' : ''}</div>
      <div class="price" style="color:${CHAIN_COLORS[k]}">${fmt(t[k])}</div>
    </div>`).join('');
  const d = new Date(DATA.generated_at);
  document.getElementById('updated').textContent = 'עודכן לאחרונה: ' + d.toLocaleDateString('he-IL');
}

function renderChart() {
  const snaps = DATA.snapshots;
  const keys = chainKeys();
  const base = {};
  keys.forEach(k => { base[k] = snaps[0].totals[k]; });
  new Chart(document.getElementById('indexChart'), {
    type: 'line',
    data: {
      labels: snaps.map(s => s.date),
      datasets: keys.map(k => ({
        label: DATA.latest.chains[k].name_he,
        data: snaps.map(s => +(100 * s.totals[k] / base[k]).toFixed(2)),
        borderColor: CHAIN_COLORS[k],
        backgroundColor: CHAIN_COLORS[k],
        tension: 0.3, pointRadius: 2,
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#16202e' } },
        tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${c.parsed.y} (${fmt(snaps[c.dataIndex].totals[keys[c.datasetIndex]])})` } } },
      scales: {
        x: { ticks: { color: '#6a7383' }, grid: { color: '#e4e7ee' } },
        y: { ticks: { color: '#6a7383' }, grid: { color: '#e4e7ee' }, title: { display: true, text: 'מדד (בסיס = 100)', color: '#6a7383' } },
      },
    },
  });
}

function renderCalc() {
  const cats = {};
  DATA.latest.items.forEach(it => { (cats[it.category] = cats[it.category] || []).push(it); });
  const el = document.getElementById('calcList');
  el.innerHTML = Object.entries(cats).map(([cat, items]) => `
    <div class="cat">${cat}</div>
    ${items.map(it => `
      <div class="item-row">
        <span class="name">${it.name_he}</span>
        <span class="price">${fmt(Math.min(...Object.values(it.prices)))}</span>
        <span class="qty" data-id="${it.id}">
          <button data-act="-">−</button><span class="n">${qty[it.id]}</span><button data-act="+">+</button>
        </span>
        ${promoChips(it)}
        ${metaChips(it)}
      </div>`).join('')}`).join('');
  el.querySelectorAll('.qty button').forEach(b => b.onclick = () => {
    const id = b.parentElement.dataset.id;
    qty[id] = Math.max(0, qty[id] + (b.dataset.act === '+' ? 1 : -1));
    b.parentElement.querySelector('.n').textContent = qty[id];
    renderResults();
  });
  renderResults();
}

function syncCalc() {
  document.querySelectorAll('.qty').forEach(q => { q.querySelector('.n').textContent = qty[q.dataset.id]; });
  renderResults();
}

function basketTotal(items, chain) {
  return items.reduce((s, it) => s + (it.prices[chain] || 0) * qty[it.id], 0);
}

// effective total: promo unit price applies only when qty >= promo min_qty
function effectiveTotal(items, chain) {
  let total = 0, applied = 0;
  items.forEach(it => {
    const q = qty[it.id];
    if (!q) return;
    const p = it.promos && it.promos[chain];
    if (p && q >= p.min_qty && p.price_eff < it.prices[chain]) { total += p.price_eff * q; applied++; }
    else total += (it.prices[chain] || 0) * q;
  });
  return { total, applied };
}

function metaChips(it) {
  const e = ENRICH[it.barcode];
  if (!e || e.non_food) return '';
  let chips = '';
  if (e.gi != null) {
    const cls = e.gi <= 55 ? 'gi-low' : (e.gi <= 69 ? 'gi-mid' : 'gi-high');
    chips += `<span class="meta-chip ${cls}">גליקמי ~${e.gi} (${e.gi_band})${e.gi_estimated ? ' · הערכה' : ''}</span>`;
  }
  if (e.allergens && e.allergens.length) {
    chips += `<span class="meta-chip">אלרגנים: ${e.allergens.join(', ')}</span>`;
  }
  return chips ? `<span class="meta">${chips}</span>` : '';
}

function promoChips(it) {
  if (!it.promos || !Object.keys(it.promos).length) return '';
  const chips = Object.entries(it.promos).map(([k, p]) => {
    const mq = p.min_qty > 1 ? `בקניית ${p.min_qty} יח׳` : '';
    const club = p.club_only ? ' · מועדון' : '';
    return `<span class="promo-chip"><span class="dot" style="background:${CHAIN_COLORS[k]}"></span>${DATA.latest.chains[k].name_he}: ${fmt(p.price_eff)} ${mq}${club}</span>`;
  }).join('');
  return `<span class="promo-chips">${chips}</span>`;
}

function renderResults() {
  const keys = chainKeys();
  const latest = DATA.latest.items;
  const totals = keys.map(k => {
    const eff = effectiveTotal(latest, k);
    return [k, eff.total, basketTotal(latest, k), eff.applied];
  }).sort((a, b) => a[1] - b[1]);
  const most = totals[totals.length - 1][1];

  // personal inflation: same quantities on first snapshot's prices
  let inflationHtml = '';
  if (DATA.snapshots.length > 1) {
    const first = DATA.snapshots[0];
    const firstFile = 'data/prices-' + first.date + '.json';
    // first snapshot items are not embedded in index.json; approximate with index ratio
  }
  const el = document.getElementById('results');
  const anyQty = Object.values(qty).some(q => q > 0);
  if (!anyQty) { el.innerHTML = '<p class="hint">בחרו לפחות מוצר אחד 🙂</p>'; return; }

  el.innerHTML = totals.map(([k, v, shelf, applied]) => `
    <div class="result-row ${k === totals[0][0] ? 'cheapest' : ''}">
      <span class="chain" style="color:${CHAIN_COLORS[k]}">${DATA.latest.chains[k].name_he}
        ${applied ? `<span class="promos-note">כולל ${applied} מבצעים</span>` : ''}
        ${k === totals[0][0] ? `<span class="save">חוסכים ${fmt(most - v)} לעומת היקר ביותר</span>` : ''}
      </span>
      <span class="prices">
        ${applied ? `<span class="shelf">${fmt(shelf)}</span>` : ''}
        <span class="price">${fmt(v)}</span>
      </span>
    </div>`).join('') +
    `<div class="personal-inflation" id="inflBox"><span class="hint">אינפלציה אישית: תתחיל לצבור היסטוריה מהימים הקרובים 📈</span></div>`;
  renderPersonalInflation();
}

let firstSnapshot = null;
async function renderPersonalInflation() {
  if (DATA.snapshots.length < 2) return;
  try {
    if (!firstSnapshot) {
      const first = DATA.snapshots[0];
      firstSnapshot = await (await fetch('data/prices-' + first.date + '.json')).json();
    }
    const keys = chainKeys();
    const now = basketTotal(DATA.latest.items, keys[0]);
    const then = DATA.latest.items.reduce((s, it) => {
      const old = firstSnapshot.items.find(o => o.id === it.id);
      return s + ((old && old.prices[keys[0]]) || 0) * qty[it.id];
    }, 0);
    if (then > 0) {
      const pct = (100 * (now - then) / then).toFixed(1);
      document.getElementById('inflBox').innerHTML =
        `הסל שלך התייקר ב-<b>${pct}%</b> מאז ${firstSnapshot.date}`;
    }
  } catch (e) { /* first snapshot file not published yet */ }
}

/* ===== receipt scan (client-side OCR, Tesseract.js + Hebrew) ===== */
let tessLoading = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();
  if (!tessLoading) tessLoading = new Promise((res, rej) => {
    const sc = document.createElement('script');
    sc.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    sc.onload = res; sc.onerror = rej;
    document.head.appendChild(sc);
  });
  return tessLoading;
}

const RSTOP = new Set(['גרם','מ״ל','מל','ליטר','ק״ג','יח']);
const RECEIPT_NOISE = ['קופה','סניף','אשרא','סהכ','סה"כ','תשלום','תודה','מזומן','עודף','מעמ','מע״מ','תאריך','שולם','חייב','זכאי','עסקה','כרטיס'];
function lev(a, b) {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 1) return 2;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i-1][j] + 1, d[i][j-1] + 1, d[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
  return d[m][n];
}
function tokMatch(a, b) {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.min(la, lb) >= 4 && (a.startsWith(b) || b.startsWith(a))) return true;
  if (Math.min(la, lb) >= 4 && lev(a, b) <= 1) return true;
  return false;
}
function rnorm(str) {
  return str.replace(/[״"׳']/g, '').replace(/[^\u0590-\u05FFa-zA-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
function itemTokens(it) {
  const src = rnorm((ENRICH[it.barcode] && ENRICH[it.barcode].matched_name) || '') + ' ' + rnorm(it.name_he);
  return [...new Set(src.split(' ').filter(w => w.length >= 2 && !RSTOP.has(w) && !/^\d+$/.test(w)))];
}
const ITOKENS = {};
function cachedTokens(it) {
  return ITOKENS[it.id] || (ITOKENS[it.id] = itemTokens(it));
}
function matchReceiptText(text) {
  const items = DATA.latest.items;
  const lines = text.split('\n').map(rnorm).filter(l => l.replace(/[0-9 ]/g, '').length >= 3);
  const found = {}; let unmatched = 0;
  for (const line of lines) {
    if (RECEIPT_NOISE.some(w => line.includes(w))) continue;
    const ltoks = line.split(' ').filter(w => w.length >= 2);
    let best = null, bestScore = 0;
    for (const it of items) {
      const toks = cachedTokens(it);
      let score = 0, exact = 0;
      for (const t of toks) {
        if (ltoks.includes(t)) { score++; exact++; }
        else if (ltoks.some(l => tokMatch(l, t))) score++;
      }
      // require >=2 token hits, at least one exact - guards against OCR-noise false positives
      if (score >= 2 && exact >= 1 && score > bestScore) { best = it; bestScore = score; }
    }
    if (best) found[best.id] = (found[best.id] || 0) + 1; else unmatched++;
  }
  return { found, unmatched };
}

function initReceipt() {
  const btn = document.getElementById('receiptBtn');
  const input = document.getElementById('receiptInput');
  const status = document.getElementById('receiptStatus');
  btn.onclick = () => input.click();
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      status.textContent = 'טוען את מנוע הקריאה (פעם ראשונה לוקח כמה שניות)...';
      await loadTesseract();
      status.textContent = 'קורא את הקבלה...';
      const { data } = await Tesseract.recognize(file, 'heb+eng');
      const { found, unmatched } = matchReceiptText(data.text || '');
      const ids = Object.keys(found);
      if (!ids.length) {
        status.innerHTML = '<span class="warn">לא זוהו מוצרים מהסל. נסו תמונה חדה וישרה של הקבלה.</span>';
        return;
      }
      DATA.latest.items.forEach(it => { qty[it.id] = found[it.id] || 0; });
      syncCalc();
      document.querySelector('.card h2').closest('main').scrollIntoView({ behavior: 'smooth' });
      status.innerHTML = `<span class="ok">זוהו ${ids.length} מוצרים מהקבלה והסל מולא ✓</span>` +
        (unmatched ? ` <span class="warn">(${unmatched} שורות לא זוהו - לא חלק מהסל)</span>` : '');
      document.getElementById('results').scrollIntoView({ behavior: 'smooth' });
    } catch (e) {
      status.innerHTML = '<span class="warn">הסריקה נכשלה. נסו שוב עם תמונה ברורה יותר.</span>';
    }
  };
}

boot();
