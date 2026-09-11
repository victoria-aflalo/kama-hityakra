const CHAIN_COLORS = { shufersal: '#d6455b', rami_levy: '#1a9e6f', carrefour: '#2f6fd0' };
const fmt = n => '₪' + n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let DATA = null;
const qty = {}; // item id -> quantity

async function boot() {
  DATA = await (await fetch('data/index.json')).json();
  DATA.latest.items.forEach(it => { qty[it.id] = 1; });
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

boot();
