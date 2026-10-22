'use strict';
/* =========================================================================
   Meu Financeiro — app.js
   Módulos: Utils · Storage · State · Services · Charts · UI · Views · Actions
   Valores sempre em CENTAVOS (inteiros).
   ========================================================================= */

/* ============================== UTILS =================================== */
const Utils = {
  uid: () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
  pad: (n) => String(n).padStart(2, '0'),
  esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  brl: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }),
  money(c) { return this.brl.format((c || 0) / 100); },
  // Número formatado sem símbolo, usado nos campos (ex.: 1.234,56)
  num(c) { return ((c || 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
  cents: (str) => Number(String(str || '').replace(/\D/g, '')) || 0,
  today() { const d = new Date(); return `${d.getFullYear()}-${this.pad(d.getMonth() + 1)}-${this.pad(d.getDate())}`; },
  monthOf: (date) => date.slice(0, 7),
  addMonths(key, n) {
    const [y, m] = key.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    return `${d.getFullYear()}-${this.pad(d.getMonth() + 1)}`;
  },
  monthsBetween(a, b) { // meses de a até b (b - a)
    const [y1, m1] = a.split('-').map(Number), [y2, m2] = b.split('-').map(Number);
    return (y2 - y1) * 12 + (m2 - m1);
  },
  monthLabel(key) {
    const [y, m] = key.split('-').map(Number);
    const s = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  },
  monthShort(key) {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
  },
  daysIn(key) { const [y, m] = key.split('-').map(Number); return new Date(y, m, 0).getDate(); },
  // day = 0 significa "penúltimo dia do mês" (padrão do app)
  dueDate(month, day) { const n = this.daysIn(month); return `${month}-${this.pad(day ? Math.min(day, n) : n - 1)}`; },
  fmtDate(s) { return s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : ''; },
  fmtDM: (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}`,
  norm: (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(),
  daysBetween(a, b) { return Math.round((new Date(b + 'T00:00') - new Date(a + 'T00:00')) / 864e5); },
  sum: (arr, fn) => arr.reduce((t, x) => t + fn(x), 0),
  download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
};

/* ============================== STORAGE ================================= */
// Única camada que toca no localStorage — fácil trocar por IndexedDB/nuvem.
const Storage = {
  KEY: 'financeiro.v1',
  load() { try { const r = localStorage.getItem(this.KEY); return r ? JSON.parse(r) : null; } catch { return null; } },
  save(data) { try { localStorage.setItem(this.KEY, JSON.stringify(data)); return true; } catch { return false; } },
  clear() { try { localStorage.removeItem(this.KEY); } catch { /* ignora */ } },
  async persist() {
    try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch { /* ignora */ }
    return false;
  }
};

/* ============================== STATE =================================== */
const DEFAULT_CATS = [
  { id: 'moradia', name: 'Moradia', color: '#5e5ce6', icon: '🏠' },
  { id: 'alimentacao', name: 'Alimentação', color: '#ff9f0a', icon: '🍽️' },
  { id: 'transporte', name: 'Transporte', color: '#64d2ff', icon: '🚗' },
  { id: 'saude', name: 'Saúde', color: '#ff6b6b', icon: '💊' },
  { id: 'educacao', name: 'Educação', color: '#bf5af2', icon: '📚' },
  { id: 'lazer', name: 'Lazer', color: '#ff6482', icon: '🎮' },
  { id: 'assinaturas', name: 'Assinaturas', color: '#40c8a0', icon: '📺' },
  { id: 'dividas', name: 'Dívidas', color: '#d6453d', icon: '💳' },
  { id: 'impostos', name: 'Impostos', color: '#ac8e68', icon: '🧾' },
  { id: 'outros', name: 'Outros', color: '#8e8e93', icon: '📦' }
];
const EMOJIS = ['🏠', '🍽️', '🚗', '💊', '📚', '🎮', '📺', '💳', '🧾', '📦', '🐶', '👶', '✈️', '🛒', '💡', '📱', '🏋️', '🎁', '👕', '🔧', '☕', '🎓', '💼', '❤️'];
const INCOME_TYPES = ['Salário', 'Extra', 'Freela', 'Rendimentos', 'Outros'];
const ASSET_TYPES = ['Renda fixa', 'CDB', 'Tesouro', 'Ações', 'FIIs', 'Cripto', 'Poupança', 'Previdência', 'Outros'];
const ASSET_COLORS = ['#007aff', '#5e5ce6', '#64d2ff', '#40c8a0', '#ff9f0a', '#ff6482', '#bf5af2', '#ac8e68', '#8e8e93'];
const METHODS = ['Pix', 'Dinheiro', 'Débito', 'Crédito', 'Boleto', 'Transferência', 'Outro'];

const State = {
  data: null,
  defaults() {
    return {
      version: 1,
      settings: { theme: 'auto', hide: false, lastBackup: null, created: new Date().toISOString(), installDismissed: false },
      categories: DEFAULT_CATS.map((c) => ({ ...c })),
      bills: [],   // {id,name,nature,cat,planned,paid,day,month,rec,series,inst,instTotal,method,note,status,paidAt}
      incomes: [], // {id,name,type,amount,day,date,month,rec,series,received}
      series: [],  // {id,kind,rec,start,end,skip[],tpl{}} — modelos de recorrência mensal/anual
      assets: [],  // {id,name,inst,type,current,moves:[{id,kind,amount,date}]}
      goals: []    // {id,name,target,saved,deadline}
    };
  },
  isValid: (d) => d && typeof d === 'object' && ['bills', 'incomes', 'series', 'assets', 'goals', 'categories'].every((k) => Array.isArray(d[k])),
  init() {
    const stored = Storage.load();
    this.data = this.isValid(stored) ? { ...this.defaults(), ...stored, settings: { ...this.defaults().settings, ...stored.settings } } : this.defaults();
    if (stored) return;
    this.save(); // primeira abertura: começa vazio (dados de exemplo ficam em Ajustes)
  },
  save() { if (!Storage.save(this.data)) UI.toast('Não foi possível salvar (armazenamento cheio?)'); },
  snapshot() { return JSON.stringify(this.data); },
  restore(snap) { this.data = JSON.parse(snap); this.save(); },
  cat(id) { return this.data.categories.find((c) => c.id === id) || this.data.categories.find((c) => c.id === 'outros') || DEFAULT_CATS[9]; }
};

/* ============================= SERVICES ================================= */
const Services = {
  // ---- Recorrência: cria instâncias do mês para contas/receitas mensais e anuais
  instance(s, m) {
    const base = { id: Utils.uid(), month: m, series: s.id, ...s.tpl };
    if (s.kind === 'bill') return { ...base, paid: 0, status: 'pendente', rec: s.rec, inst: 0, instTotal: 0 };
    return { ...base, date: Utils.dueDate(m, s.tpl.day), rec: 'fixa', received: false };
  },
  ensureMonth(m) {
    const d = State.data; let changed = false;
    for (const s of d.series) {
      if (m < s.start || (s.end && m > s.end) || s.skip.includes(m)) continue;
      if (s.rec === 'anual' && m.slice(5) !== s.start.slice(5)) continue;
      const col = s.kind === 'bill' ? d.bills : d.incomes;
      if (col.some((x) => x.series === s.id && x.month === m)) continue;
      col.push(this.instance(s, m)); changed = true;
    }
    if (changed) State.save();
  },
  ensureRange(from, to) { for (let m = from; m <= to; m = Utils.addMonths(m, 1)) this.ensureMonth(m); },

  // ---- Status e totais
  status(b) {
    if (b.status === 'pago') return 'pago';
    return Utils.dueDate(b.month, b.day) < Utils.today() ? 'atrasado' : b.status;
  },
  cost: (b) => (b.status === 'pago' ? b.paid : Math.max(b.planned, b.paid)),
  monthStats(m) {
    this.ensureMonth(m);
    const bills = State.data.bills.filter((b) => b.month === m);
    const incomes = State.data.incomes.filter((i) => i.month === m);
    const st = { bills, incomes, projected: 0, planned: 0, paid: 0, remaining: 0, overdue: 0, overdueCount: 0, fixedPlanned: 0, fixedCost: 0, varPlanned: 0, varPaid: 0, varCost: 0 };
    for (const b of bills) {
      const cost = this.cost(b), fixed = b.nature === 'fixa';
      st.projected += cost; st.planned += b.planned; st.paid += b.paid;
      const rest = b.status === 'pago' ? 0 : Math.max(0, b.planned - b.paid);
      st.remaining += rest;
      if (this.status(b) === 'atrasado') { st.overdue += rest; st.overdueCount++; }
      if (fixed) { st.fixedPlanned += b.planned; st.fixedCost += cost; } else { st.varPlanned += b.planned; st.varPaid += b.paid; st.varCost += cost; }
    }
    st.income = Utils.sum(incomes, (i) => i.amount);
    st.received = Utils.sum(incomes.filter((i) => i.received), (i) => i.amount);
    st.balance = st.income - st.projected;
    st.cash = st.received - st.paid;
    st.pct = st.projected ? Math.min(100, Math.round((st.paid / st.projected) * 100)) : 0;
    return st;
  },
  byCategory(bills) {
    const map = new Map();
    for (const b of bills) map.set(b.cat, (map.get(b.cat) || 0) + this.cost(b));
    return [...map].map(([id, value]) => ({ id, value, label: State.cat(id).name, color: State.cat(id).color })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
  },
  last12(end) {
    const out = [];
    for (let i = 11; i >= 0; i--) {
      const m = Utils.addMonths(end, -i), s = this.monthStats(m);
      out.push({ m, label: Utils.monthShort(m), a: s.income, b: s.projected });
    }
    return out;
  },
  annual(year) {
    const months = [];
    for (let i = 1; i <= 12; i++) { const m = `${year}-${Utils.pad(i)}`; months.push({ m, st: this.monthStats(m) }); }
    const total = Utils.sum(months, (x) => x.st.projected);
    const active = months.filter((x) => x.st.projected > 0);
    const top = [...months].sort((a, b) => b.st.projected - a.st.projected)[0];
    const cats = this.byCategory(months.flatMap((x) => x.st.bills));
    return { total, avg: active.length ? Math.round(total / active.length) : 0, topMonth: top && top.st.projected ? top : null, topCat: cats[0] || null };
  },

  // ---- CRUD de contas e receitas
  addBill(f) {
    const d = State.data;
    const tpl = { name: f.name, nature: f.nature, cat: f.cat, planned: f.planned, day: f.day, method: f.method, note: f.note };
    if (f.rec === 'mensal' || f.rec === 'anual') {
      d.series.push({ id: Utils.uid(), kind: 'bill', rec: f.rec, start: f.month, end: null, skip: [], tpl });
      this.ensureMonth(f.month);
    } else if (f.rec === 'parcelada') {
      const group = Utils.uid();
      for (let i = f.inst; i <= f.total; i++) {
        d.bills.push({ id: Utils.uid(), ...tpl, month: Utils.addMonths(f.month, i - f.inst), paid: 0, status: 'pendente', rec: 'parcelada', series: group, inst: i, instTotal: f.total });
      }
    } else {
      d.bills.push({ id: Utils.uid(), ...tpl, month: f.month, paid: 0, status: 'pendente', rec: 'unica', series: null, inst: 0, instTotal: 0 });
    }
    State.save();
  },
  addIncome(f) {
    const d = State.data, month = Utils.monthOf(f.date), day = f.day === undefined ? Number(f.date.slice(8)) : f.day;
    const tpl = { name: f.name, type: f.type, amount: f.amount, day };
    if (f.rec === 'fixa') {
      d.series.push({ id: Utils.uid(), kind: 'income', rec: 'mensal', start: month, end: null, skip: [], tpl });
      this.ensureMonth(month);
      const inst = d.incomes.find((i) => i.month === month && i.series === d.series[d.series.length - 1].id);
      if (inst) { inst.date = f.date; inst.received = f.received; }
    } else {
      d.incomes.push({ id: Utils.uid(), ...tpl, date: f.date, month, rec: 'variavel', series: null, received: f.received });
    }
    State.save();
  },
  collection: (kind) => (kind === 'bill' ? State.data.bills : State.data.incomes),
  tplFields: (kind) => (kind === 'bill' ? ['name', 'nature', 'cat', 'planned', 'day', 'method', 'note'] : ['name', 'type', 'amount', 'day']),
  // scope: 'one' | 'following' (este e os próximos)
  updateItem(kind, id, patch, scope) {
    const col = this.collection(kind), item = col.find((x) => x.id === id);
    if (!item) return;
    Object.assign(item, patch);
    if (kind === 'income' && patch.date) { item.month = Utils.monthOf(item.date); item.day = Number(item.date.slice(8)); }
    if (scope === 'following' && item.series) {
      const fields = this.tplFields(kind), pick = Object.fromEntries(fields.map((f) => [f, item[f]]));
      for (const o of col) {
        if (o.series !== item.series || o.id === id || o.month <= item.month || o.status === 'pago' || o.received) continue;
        Object.assign(o, pick);
        if (kind === 'income') o.date = Utils.dueDate(o.month, o.day);
      }
      const s = State.data.series.find((x) => x.id === item.series);
      if (s) Object.assign(s.tpl, pick);
    }
    State.save();
  },
  removeItem(kind, id, scope) {
    const d = State.data, col = this.collection(kind), item = col.find((x) => x.id === id);
    if (!item) return;
    const s = d.series.find((x) => x.id === item.series);
    const drop = scope === 'following' && item.series
      ? (o) => o.series === item.series && o.month >= item.month && (o.id === id || (o.status !== 'pago' && !o.received))
      : (o) => o.id === id;
    const rest = col.filter((o) => !drop(o));
    col.length = 0; col.push(...rest);
    if (s) {
      if (scope === 'following') {
        s.end = Utils.addMonths(item.month, -1);
        if (s.end < s.start) d.series = d.series.filter((x) => x !== s);
      } else s.skip.push(item.month);
    }
    State.save();
  },
  pay(id, amount, settle) {
    const b = State.data.bills.find((x) => x.id === id);
    b.paid = amount;
    b.status = amount <= 0 ? 'pendente' : (amount >= b.planned || settle ? 'pago' : 'parcial');
    b.paidAt = b.status === 'pendente' ? null : Utils.today();
    State.save();
  },
  toggleReceived(id) {
    const i = State.data.incomes.find((x) => x.id === id);
    i.received = !i.received; State.save();
  },

  // ---- Investimentos
  invested: (a) => Utils.sum(a.moves, (m) => (m.kind === 'aporte' ? m.amount : -m.amount)),
  patrimony: () => Utils.sum(State.data.assets, (a) => a.current),
  addAsset(f) {
    State.data.assets.push({ id: Utils.uid(), name: f.name, inst: f.inst, type: f.type, current: f.current, moves: f.invested > 0 ? [{ id: Utils.uid(), kind: 'aporte', amount: f.invested, date: f.date }] : [] });
    State.save();
  },
  addMove(assetId, kind, amount, date) {
    const a = State.data.assets.find((x) => x.id === assetId);
    a.moves.push({ id: Utils.uid(), kind, amount, date });
    a.current = Math.max(0, a.current + (kind === 'aporte' ? amount : -amount));
    State.save();
  },
  removeMove(assetId, moveId) {
    const a = State.data.assets.find((x) => x.id === assetId), mv = a.moves.find((x) => x.id === moveId);
    a.current = Math.max(0, a.current - (mv.kind === 'aporte' ? mv.amount : -mv.amount));
    a.moves = a.moves.filter((x) => x.id !== moveId);
    State.save();
  },
  distribution() {
    const map = new Map();
    for (const a of State.data.assets) map.set(a.type, (map.get(a.type) || 0) + a.current);
    return [...map].map(([label, value], i) => ({ label, value, color: ASSET_COLORS[ASSET_TYPES.indexOf(label) % ASSET_COLORS.length] || ASSET_COLORS[i] })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
  },
  // Aportado líquido acumulado ao fim de cada um dos últimos 12 meses
  investEvolution(end) {
    const out = [];
    for (let i = 11; i >= 0; i--) {
      const m = Utils.addMonths(end, -i);
      const total = Utils.sum(State.data.assets, (a) => Utils.sum(a.moves.filter((mv) => mv.date.slice(0, 7) <= m), (mv) => (mv.kind === 'aporte' ? mv.amount : -mv.amount)));
      out.push({ m, label: Utils.monthShort(m), a: total });
    }
    return out;
  },
  goalMonthly(g) {
    const months = Math.max(1, Utils.monthsBetween(Utils.today().slice(0, 7), g.deadline.slice(0, 7)));
    return { months, need: Math.ceil(Math.max(0, g.target - g.saved) / months) };
  },

  // ---- Exportação
  csv(from, to, cat) {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`, n = (c) => (c / 100).toFixed(2).replace('.', ',');
    const rows = [['Tipo', 'Competência', 'Vencimento/Data', 'Nome', 'Natureza/Tipo', 'Categoria', 'Previsto', 'Pago/Recebido', 'Status', 'Forma', 'Observação']];
    for (const b of State.data.bills.filter((x) => x.month >= from && x.month <= to && (!cat || x.cat === cat)).sort((a, b) => a.month.localeCompare(b.month) || a.day - b.day)) {
      rows.push(['Despesa', b.month, Utils.dueDate(b.month, b.day), b.name + (b.instTotal ? ` (${b.inst}/${b.instTotal})` : ''), b.nature, State.cat(b.cat).name, n(b.planned), n(b.paid), this.status(b), b.method, b.note]);
    }
    if (!cat) for (const i of State.data.incomes.filter((x) => x.month >= from && x.month <= to)) {
      rows.push(['Receita', i.month, i.date, i.name, i.type, '', n(i.amount), n(i.received ? i.amount : 0), i.received ? 'recebido' : 'a receber', '', '']);
    }
    return '\ufeff' + rows.map((r) => r.map(q).join(';')).join('\r\n');
  },

  // ---- Dados de exemplo
  loadSample() {
    const d = State.defaults(); State.data = d;
    const today = Utils.today(), cur = Utils.monthOf(today), dayNow = Number(today.slice(8)), start = Utils.addMonths(cur, -3);
    const bill = (name, nature, cat, planned, day, rec, month = start, extra = {}) =>
      this.addBill({ name, nature, cat, planned, day, rec, month, method: 'Pix', note: '', ...extra });
    bill('Aluguel', 'fixa', 'moradia', 150000, 5, 'mensal');
    bill('Condomínio', 'fixa', 'moradia', 42000, 10, 'mensal');
    bill('Energia elétrica', 'fixa', 'moradia', 18000, 15, 'mensal');
    bill('Internet', 'fixa', 'moradia', 9990, 3, 'mensal');
    bill('Plano de saúde', 'fixa', 'saude', 38000, 8, 'mensal');
    bill('Netflix', 'fixa', 'assinaturas', 5590, 12, 'mensal');
    bill('Spotify', 'fixa', 'assinaturas', 2190, 20, 'mensal');
    bill('Academia', 'fixa', 'saude', 11000, 7, 'mensal');
    bill('Notebook', 'fixa', 'dividas', 32000, 18, 'parcelada', cur, { inst: 3, total: 10 });
    bill('IPTU', 'fixa', 'impostos', 45000, 28, 'anual', cur);
    for (let m = start, i = 0; m <= cur; m = Utils.addMonths(m, 1), i++) {
      bill('Mercado', 'variavel', 'alimentacao', 90000, 14, 'unica', m);
      bill('Delivery', 'variavel', 'alimentacao', 25000, 22, 'unica', m);
      bill('Transporte (app)', 'variavel', 'transporte', 20000, 25, 'unica', m);
      bill('Lazer', 'variavel', 'lazer', 30000, 27, 'unica', m);
    }
    this.addIncome({ name: 'Salário', type: 'Salário', amount: 650000, date: `${start}-05`, rec: 'fixa', received: true });
    this.addIncome({ name: 'Freela site', type: 'Freela', amount: 80000, date: `${Utils.addMonths(cur, -1)}-20`, rec: 'variavel', received: true });
    this.ensureRange(start, Utils.addMonths(cur, 1));
    // Marca como pagas as contas passadas (valor real varia um pouco nas variáveis) e parte das do mês atual
    State.data.bills.forEach((b, i) => {
      const past = b.month < cur, nowOk = b.month === cur && b.day < dayNow - 1 && b.day !== 3;
      if (!past && !nowOk) return;
      b.paid = b.nature === 'variavel' ? Math.round(b.planned * (0.82 + ((i * 37) % 40) / 100)) : b.planned;
      b.status = 'pago'; b.paidAt = Utils.dueDate(b.month, b.day);
    });
    State.data.incomes.forEach((i) => { i.received = i.month < cur || (i.month === cur && i.day <= dayNow); });
    const ago = (n) => Utils.addMonths(cur, -n) + '-10';
    const asset = (name, inst, type, current, moves) => State.data.assets.push({ id: Utils.uid(), name, inst, type, current, moves: moves.map(([amount, n]) => ({ id: Utils.uid(), kind: 'aporte', amount, date: ago(n) })) });
    asset('Tesouro Selic 2029', 'Tesouro Direto', 'Tesouro', 1285000, [[500000, 8], [400000, 5], [300000, 2]]);
    asset('CDB 110% CDI', 'Banco Inter', 'CDB', 620000, [[300000, 7], [300000, 3]]);
    asset('HGLG11', 'XP', 'FIIs', 215000, [[100000, 6], [100000, 2]]);
    asset('Bitcoin', 'Binance', 'Cripto', 98000, [[80000, 4]]);
    State.data.goals.push(
      { id: Utils.uid(), name: 'Reserva de emergência', target: 3000000, saved: 1500000, deadline: Utils.addMonths(cur, 12) + '-01' },
      { id: Utils.uid(), name: 'Viagem de férias', target: 800000, saved: 120000, deadline: Utils.addMonths(cur, 8) + '-01' }
    );
    State.save();
  }
};

/* ============================== CHARTS (SVG) ============================ */
const Charts = {
  donut(items) {
    const total = Utils.sum(items, (x) => x.value);
    if (!total) return '<p class="empty">Sem dados no período.</p>';
    const R = 40, C = 2 * Math.PI * R; let off = 0;
    const arcs = items.map((x) => {
      const len = (x.value / total) * C, el = `<circle cx="60" cy="60" r="${R}" fill="none" stroke="${x.color}" stroke-width="18" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 60 60)"><title>${Utils.esc(x.label)}</title></circle>`;
      off += len; return el;
    }).join('');
    const legend = items.slice(0, 6).map((x) => `<div><i style="background:${x.color}"></i><span>${Utils.esc(x.label)}</span><b>${Math.round((x.value / total) * 100)}%</b></div>`).join('');
    return `<div class="donut-wrap"><svg class="donut" viewBox="0 0 120 120" role="img" aria-label="Gráfico de rosca">${arcs}</svg><div class="legend">${legend}</div></div>`;
  },
  // Barras agrupadas: a (verde) e opcionalmente b (vermelho)
  bars(data, { aColor = '#16a34a', bColor = '#ef4444', two = true } = {}) {
    const max = Math.max(1, ...data.map((d) => Math.max(d.a, two ? d.b : 0))), H = 120, W = 340, g = W / data.length, bw = two ? g * 0.34 : g * 0.56;
    const bar = (v, x, color, label) => `<rect x="${x}" y="${H - (v / max) * H + 4}" width="${bw}" height="${Math.max(1, (v / max) * H)}" rx="3" fill="${color}"><title>${label}: ${Utils.money(v)}</title></rect>`;
    const cols = data.map((d, i) => {
      const x0 = i * g + (g - (two ? bw * 2 + 2 : bw)) / 2;
      return bar(d.a, x0, aColor, d.label) + (two ? bar(d.b, x0 + bw + 2, bColor, d.label) : '') + `<text x="${i * g + g / 2}" y="${H + 18}">${d.label}</text>`;
    }).join('');
    return `<svg class="bars" viewBox="0 0 ${W} ${H + 24}" role="img" aria-label="Gráfico de barras">${cols}</svg>`;
  }
};

/* ================================ UI ==================================== */
const ICON = {
  eye: '<svg viewBox="0 0 24 24"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24"><path d="M17.9 17.9A10.9 10.9 0 0112 19C5 19 1 12 1 12a18 18 0 015.1-5.9M9.9 5.1A10 10 0 0112 5c7 0 11 7 11 7a18 18 0 01-2.2 3.2M1 1l22 22"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>'
};

const UI = {
  month: Utils.monthOf(Utils.today()),
  f: { status: 'todos', cat: 'todas', q: '', search: false },
  rep: null,
  noClick: 0,
  deferredPrompt: null,
  cur: null,
  $: (s) => document.querySelector(s),
  m: (c) => (State.data.settings.hide ? 'R$ ••••' : Utils.money(c)),
  vibe(ms = 15) { if (navigator.vibrate) navigator.vibrate(ms); },

  applyTheme() {
    const t = State.data.settings.theme;
    const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = dark ? '#000000' : '#f2f2f7';
  },

  toast(msg, { undo } = {}) {
    const box = this.$('#toast'), el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<span>${Utils.esc(msg)}</span>${undo ? '<button type="button">Desfazer</button>' : ''}`;
    if (undo) el.querySelector('button').onclick = () => { State.restore(undo); el.remove(); UI.vibe(); UI.refresh(); };
    box.replaceChildren(el); // um aviso por vez, sem empilhar
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.remove(), undo ? 5000 : 2200);
  },

  /* ---- Bottom sheets / diálogos ---- */
  sheet({ title, body, submit, onSubmit, onMount, focus = false, target = '#sheet' }) {
    const host = this.$(target), swap = !!host.innerHTML; // troca de formulário sem reanimar
    host.innerHTML = `<div class="backdrop ${swap ? 'still' : ''}" data-act="${target === '#sheet' ? 'closeSheet' : 'closeDialog'}"></div>
      <section class="sheet ${swap ? 'still' : ''}" role="dialog" aria-modal="true" aria-label="${Utils.esc(title)}">
        <div class="grab"></div>
        <header class="sheet-h"><h2>${Utils.esc(title)}</h2><button type="button" class="icon-btn" data-act="${target === '#sheet' ? 'closeSheet' : 'closeDialog'}" aria-label="Fechar">${ICON.x}</button></header>
        <form class="sheet-b" novalidate>${body}<p class="form-err" role="alert"></p>${submit ? `<button type="submit" class="btn primary block">${Utils.esc(submit)}</button>` : ''}</form>
      </section>`;
    document.body.classList.add('lock');
    const ctx = { onSubmit, form: host.querySelector('form') };
    if (target === '#sheet') this.cur = ctx;
    const first = host.querySelector('input:not([type=radio]):not([type=checkbox]):not([type=color]),select,textarea');
    if (first && (focus || !matchMedia('(pointer: coarse)').matches)) first.focus();
    if (onMount) onMount(ctx.form);
    return ctx;
  },
  closeHost(target) {
    const host = this.$(target);
    if (!host.innerHTML) return;
    host.querySelectorAll('.sheet,.backdrop').forEach((e) => e.classList.add('closing'));
    setTimeout(() => { host.innerHTML = ''; if (!this.$('#sheet').innerHTML && !this.$('#dialog').innerHTML) document.body.classList.remove('lock'); }, 190);
    if (target === '#sheet') this.cur = null;
  },
  // Diálogo de escolha (retorna o valor escolhido ou null)
  choose(title, text, options) {
    return new Promise((resolve) => {
      const body = `${text ? `<p class="muted">${Utils.esc(text)}</p>` : ''}<div class="tiles">${options.map((o) => `<button type="button" class="btn ${o.cls || ''}" data-choice="${o.v}">${Utils.esc(o.t)}</button>`).join('')}<button type="button" class="btn" data-choice="">Cancelar</button></div>`;
      this.sheet({ title, body, target: '#dialog' });
      this.dialogResolve = (v) => { this.dialogResolve = null; this.closeHost('#dialog'); resolve(v || null); };
    });
  },
  confirmDel(text) { return this.choose('Excluir?', text, [{ v: 'ok', t: 'Excluir', cls: 'danger' }]); },
  // Pergunta "só este mês / este e próximos" quando o item pertence a uma série
  scope(item, verb) {
    if (!item.series) return Promise.resolve('one');
    const parcel = item.rec === 'parcelada';
    return this.choose(`${verb} recorrência`, 'Deseja aplicar a alteração só neste lançamento ou nos próximos também?', [
      { v: 'one', t: parcel ? 'Só esta parcela' : 'Só este mês' }, { v: 'following', t: parcel ? 'Esta e as próximas' : 'Este e os próximos', cls: 'primary' }]);
  },

  /* ---- Helpers de formulário ---- */
  field: (label, input, id = '') => `<div class="field"><label ${id ? `for="${id}"` : ''}>${label}</label>${input}</div>`,
  input(name, label, val = '', attrs = '') { return this.field(label, `<input id="f-${name}" name="${name}" value="${Utils.esc(val)}" ${attrs}>`, `f-${name}`); },
  money(name, label, cents) { return this.field(label, `<input id="f-${name}" class="money" name="${name}" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${cents ? Utils.num(cents) : ''}">`, `f-${name}`); },
  select(name, label, opts, val, attrs = '') {
    return this.field(label, `<select id="f-${name}" name="${name}" ${attrs}>${opts.map((o) => { const v = o.v ?? o, t = o.t ?? o; return `<option value="${Utils.esc(v)}" ${v === val ? 'selected' : ''}>${Utils.esc(t)}</option>`; }).join('')}</select>`, `f-${name}`);
  },
  seg(name, opts, val, label) {
    return `<div class="field"><span class="lbl">${label}</span><div class="seg" role="radiogroup" aria-label="${label}">${opts.map((o) => `<label><input type="radio" name="${name}" value="${o.v}" ${o.v === val ? 'checked' : ''}><span>${o.t}</span></label>`).join('')}</div></div>`;
  },
  val: (form, name) => (form.elements[name] ? form.elements[name].value : ''),

  /* ---- Render / roteamento ---- */
  route() {
    const [, name = 'inicio', arg] = location.hash.replace('#', '').split('/');
    return { name: ['inicio', 'analise', 'invest', 'ativo', 'mais', 'relatorios', 'categorias'].includes(name) ? name : 'inicio', arg };
  },
  render(anim) {
    const { name, arg } = this.route(), view = $v();
    view.innerHTML = Views[name](arg);
    if (anim) { view.classList.remove('anim'); void view.offsetWidth; view.classList.add('anim'); window.scrollTo(0, 0); }
    document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === name || (name === 'ativo' && a.dataset.tab === 'invest') || ((name === 'relatorios' || name === 'categorias') && a.dataset.tab === 'mais')));
  },
  refresh() { const y = window.scrollY; this.render(false); window.scrollTo(0, y); },
  shift(n) { this.month = Utils.addMonths(this.month, n); this.vibe(8); this.refresh(); },
  commit(msg, undo) { UI.vibe(); if (msg) UI.toast(msg, { undo }); UI.refresh(); }
};
const $v = () => document.getElementById('view');

/* ============================== COMPONENTES ============================= */
const C = {
  header(title, { back, right = '' } = {}) {
    return `<header class="top"><div class="top-row">${back ? `<button class="icon-btn" data-act="back" aria-label="Voltar">${ICON.back}</button>` : ''}<h1 class="grow">${title}</h1>${right}</div></header>`;
  },
  monthBar() {
    return `<div class="month-bar" data-mswipe><button class="icon-btn" data-act="prevMonth" aria-label="Mês anterior">‹</button><div class="month-label">${Utils.monthLabel(UI.month)}</div><button class="icon-btn" data-act="nextMonth" aria-label="Próximo mês">›</button></div>`;
  },
  empty: (icon, text) => `<div class="empty"><div class="big">${icon}</div><p>${text}</p></div>`,
  swipe(kind, id, front, { pay = 'Pagar' } = {}) {
    return `<div class="swipe" data-kind="${kind}" data-id="${id}"><div class="sw-bg sw-pay">✓ ${pay}</div><div class="sw-bg sw-del">Excluir 🗑</div>${front}</div>`;
  },
  bill(b) {
    const st = Services.status(b), done = b.status === 'pago';
    const sub = done ? 'Paga' : b.instTotal ? `Parcela ${b.inst}/${b.instTotal}` : b.nature === 'fixa' ? 'Fixa' : 'Variável';
    const label = { atrasado: 'Atrasada', parcial: `Pago ${UI.m(b.paid)}` }[st] || '';
    const front = `<div class="sw-front item ${done ? 'done' : ''}" data-act="editBill" data-id="${b.id}" role="button" tabindex="0" aria-label="${Utils.esc(b.name)}">
      <button type="button" class="chk ${done ? 'on' : ''} ${st === 'atrasado' ? 'late' : ''}" data-act="quickPay" data-id="${b.id}" aria-label="${done ? 'Desmarcar pagamento' : 'Marcar como pago'}: ${Utils.esc(b.name)}"><i></i></button>
      <div class="grow"><strong>${Utils.esc(b.name)}</strong><small>${Utils.esc(sub)}</small></div>
      <div class="right"><b>${UI.m(done ? b.paid : b.planned)}</b>${label ? `<span class="badge st-${st}">${label}</span>` : ''}</div></div>`;
    return this.swipe('bill', b.id, front, { pay: done ? 'Desfazer' : 'Pagar' });
  },
  income(i) {
    const st = i.received ? 'recebido' : 'areceber';
    const front = `<div class="sw-front item ${i.received ? 'done' : ''}" data-act="editIncome" data-id="${i.id}" role="button" tabindex="0" aria-label="${Utils.esc(i.name)}">
      <button type="button" class="chk ${i.received ? 'on' : ''}" data-act="quickReceive" data-id="${i.id}" aria-label="${i.received ? 'Desmarcar recebimento' : 'Marcar como recebido'}: ${Utils.esc(i.name)}"><i></i></button>
      <div class="grow"><strong>${Utils.esc(i.name)}</strong>      <small>${i.received ? 'Recebido' : 'A receber'}</small></div>
            <div class="right"><b>${UI.m(i.amount)}</b></div></div>`;
    return this.swipe('income', i.id, front, { pay: i.received ? 'Desfazer' : 'Receber' });
  },
  chips(group, opts, cur) {
    return `<div class="chips" role="group">${opts.map((o) => `<button type="button" class="chip ${o.v === cur ? 'on' : ''}" data-act="setFilter" data-k="${group}" data-v="${o.v}" aria-pressed="${o.v === cur}">${Utils.esc(o.t)}</button>`).join('')}</div>`;
  }
};

/* ================================ VIEWS ================================= */
const Views = {
  /* ---------- Início ---------- */
  inicio() {
    const m = UI.month, s = Services.monthStats(m), S = State.data;
    const today = Utils.today(), cur = Utils.monthOf(today);
    const hide = S.settings.hide;
    const banners = [];
    const age = Utils.daysBetween((S.settings.lastBackup || S.settings.created).slice(0, 10), today);
    if (age > 30) banners.push(`<div class="banner"><div class="grow">${S.settings.lastBackup ? `Último backup há ${age} dias.` : 'Você ainda não fez backup.'}</div><button class="link" data-act="backup">Fazer backup</button></div>`);
    if (UI.deferredPrompt && !S.settings.installDismissed) banners.push(`<div class="banner"><div class="grow">Instale o app para abrir direto da tela inicial.</div><button class="link" data-act="install">Instalar</button><button class="link" data-act="dismissInstall" aria-label="Dispensar">✕</button></div>`);
    else if (Views.isIOS() && !Views.standalone() && !S.settings.installDismissed) banners.push(`<div class="banner"><div class="grow">Para instalar: <b>Compartilhar</b> › <b>Adicionar à Tela de Início</b>.</div><button class="link" data-act="dismissInstall" aria-label="Dispensar">✕</button></div>`);

    const hints = [], f = UI.f;
    if (f.status === 'atrasado') hints.push(`<div class="hint">Mostrando só as atrasadas · <button class="link inline" data-act="setFilter" data-k="status" data-v="todos">Ver todas</button></div>`);
    else if (s.overdueCount) hints.push(`<button class="hint link-hint" data-act="setFilter" data-k="status" data-v="atrasado">${s.overdueCount === 1 ? '1 conta atrasada' : s.overdueCount + ' contas atrasadas'} · ${UI.m(s.overdue)} <span>Ver ›</span></button>`);
    if (S.bills.length && !S.settings.swipeSeen) hints.push(`<div class="hint tip">Dica: deslize uma linha para a direita para pagar, ou para a esquerda para excluir. <button class="link inline" data-act="dismissTip">Ok</button></div>`);
    if (s.varPlanned && s.varPaid > s.varPlanned) hints.push(`<div class="hint">Variáveis passaram do previsto em ${UI.m(s.varPaid - s.varPlanned)}</div>`);
    const empty = !S.bills.length && !S.incomes.length && !S.series.length;
    const status = (v, t) => `<button type="button" class="${f.status === v ? 'on' : ''}" data-act="setFilter" data-k="status" data-v="${v}" aria-pressed="${f.status === v}">${t}</button>`;

    return `<header class="top">${C.monthBar()}</header>
    <div class="page">
      ${banners.join('')}
      <section class="card sum" data-mswipe aria-label="Resumo do mês">
        <div class="sum-top"><span class="lbl">Sobra do mês</span><button class="icon-btn" data-act="toggleHide" aria-label="${hide ? 'Mostrar valores' : 'Ocultar valores'}">${hide ? ICON.eyeOff : ICON.eye}</button></div>
        <div class="big ${s.balance < 0 ? 'neg' : ''}">${UI.m(s.balance)}</div>
        <div class="sum-line"><div><small>Receitas</small><b>${UI.m(s.income)}</b></div><div><small>Contas</small><b>${UI.m(s.projected)}</b></div></div>
        <div class="progress" role="progressbar" aria-valuenow="${s.pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Contas pagas"><i style="width:${s.pct}%"></i></div>
        <div class="foot"><small>Falta pagar</small><b>${UI.m(s.remaining)}</b></div>
      </section>
      ${hints.join('')}
      ${empty ? `<div class="card empty"><div class="big"><svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="var(--primary)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg></div><p><b>Comece pela sua primeira conta</b><br>Toque no + para cadastrar contas fixas, variáveis e seu salário.</p><button class="btn primary" data-act="openAdd">Adicionar conta</button><button class="link" data-act="sample">Ver com dados de exemplo</button></div>` : `
      <div class="ctl"><div class="seg">${status('todos', 'Todas')}${status('pendente', 'A pagar')}${status('pago', 'Pagas')}</div><button class="icon-btn" data-act="toggleSearch" aria-label="Buscar e filtrar" aria-pressed="${f.search}">${ICON.search}</button></div>
      ${f.search ? `<input class="search" type="search" data-q placeholder="Buscar por nome…" aria-label="Buscar" value="${Utils.esc(f.q)}">` : ''}
      <div id="bill-list" class="page" style="padding:0">${Views.listHtml()}</div>`}
      ${m !== cur ? '<button class="link" data-act="goToday">Voltar para o mês atual</button>' : ''}
    </div>`;
  },

  // Listas do mês agrupadas: Receitas, Fixas e Variáveis (a pagar primeiro)
  listHtml() {
    const f = UI.f, q = Utils.norm(f.q), m = UI.month, S = State.data;
    Services.ensureMonth(m);
    const late = f.status === 'atrasado';
    const show = (done) => f.status === 'todos' || late || (f.status === 'pago') === done;
    const bills = S.bills.filter((b) => b.month === m && Utils.norm(b.name).includes(q) && show(b.status === 'pago') && (!late || Services.status(b) === 'atrasado'))
      .sort((a, b) => (a.status === 'pago') - (b.status === 'pago') || Utils.norm(a.name).localeCompare(Utils.norm(b.name)));
    const incomes = late ? [] : S.incomes.filter((i) => i.month === m && Utils.norm(i.name).includes(q) && show(i.received)).sort((a, b) => a.received - b.received || a.name.localeCompare(b.name));
    const sec = (title, total, done, items, render) => (items.length
      ? `<div class="sec"><h2>${title}</h2><span>${UI.m(total)}</span></div><div class="list">${items.map(render).join('')}</div>` : '');
    const fixed = bills.filter((b) => b.nature === 'fixa'), vari = bills.filter((b) => b.nature !== 'fixa');
    const html = sec('Receitas', Utils.sum(incomes, (i) => i.amount), Utils.sum(incomes.filter((i) => i.received), (i) => i.amount), incomes, (i) => C.income(i))
      + sec('Contas fixas', Utils.sum(fixed, (b) => Services.cost(b)), Utils.sum(fixed, (b) => b.paid), fixed, (b) => C.bill(b))
      + sec('Contas variáveis', Utils.sum(vari, (b) => Services.cost(b)), Utils.sum(vari, (b) => b.paid), vari, (b) => C.bill(b));
    return html || C.empty('🧾', 'Nada por aqui neste mês.');
  },
  isIOS: () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
  standalone: () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,

  /* ---------- Análise (gráficos) ---------- */
  analise() {
    const m = UI.month, s = Services.monthStats(m), hide = State.data.settings.hide;
    Services.ensureRange(Utils.addMonths(m, -11), m);
    const split = s.fixedCost + s.varCost, fixedPct = split ? (s.fixedCost / split) * 100 : 0;
    const ann = Services.annual(m.slice(0, 4));
    const varNote = s.varPlanned && s.varPaid > s.varPlanned ? `<small style="color:var(--bad)">estourou ${UI.m(s.varPaid - s.varPlanned)}</small>` : `<small>previsto ${UI.m(s.varPlanned)}</small>`;
    return `<header class="top">${C.monthBar()}</header>
    <div class="page">
      <div class="card"><h3>Fixas × Variáveis</h3>
        <div class="stack" aria-hidden="true"><i style="width:${fixedPct}%;        background:#007aff"></i><i style="width:${split ? 100 - fixedPct : 0}%;background:#c7c7cc"></i></div>
                <div class="kv"><div><span class="dot" style="background:#007aff"></span>Fixas<b>${UI.m(s.fixedCost)}</b>${s.income ? `<small>${hide ? '••' : Math.round((s.fixedCost / s.income) * 100) + '%'} da renda</small>` : ''}</div><div><span class="dot" style="background:#c7c7cc"></span>Variáveis<b>${UI.m(s.varCost)}</b>${varNote}</div></div></div>
      <div class="card"><h3>Últimos 12 meses</h3><small><span class="dot" style="background:#007aff"></span>Receitas <span class="dot" style="background:#c7c7cc"></span>Despesas</small>${Charts.bars(Services.last12(m), { aColor: '#007aff', bColor: '#c7c7cc' })}</div>
      <div class="card"><h3>Resumo de ${m.slice(0, 4)}</h3><div class="kv">
        <div><small>Total gasto</small><b>${UI.m(ann.total)}</b></div><div><small>Média mensal</small><b>${UI.m(ann.avg)}</b></div>
        <div><small>Mês mais caro</small><b>${ann.topMonth ? Utils.monthLabel(ann.topMonth.m).split(' ')[0] : '—'}</b><small>${ann.topMonth ? UI.m(ann.topMonth.st.projected) : ''}</small></div>
</div></div>
      <div class="list"><a class="card item" href="#/relatorios"><div class="grow"><strong>Relatórios por período</strong></div><small>›</small></a></div>
    </div>`;
  },
  /* ---------- Investimentos ---------- */
  invest() {
    const S = State.data, pat = Services.patrimony(), inv = Utils.sum(S.assets, (a) => Services.invested(a)), ret = pat - inv;
    const pct = inv > 0 ? (ret / inv) * 100 : 0;
    const assets = S.assets.map((a) => {
      const i = Services.invested(a), r = a.current - i;
      return `<a class="card item" href="#/ativo/${a.id}"><div class="grow"><strong>${Utils.esc(a.name)}</strong><small>${Utils.esc(a.type)}${a.inst ? ' · ' + Utils.esc(a.inst) : ''}</small></div><div class="right"><b>${UI.m(a.current)}</b><small>${r >= 0 ? '+' : ''}${UI.m(r)} (${i > 0 ? ((r / i) * 100).toFixed(1) : '0.0'}%)</small></div></a>`;
    }).join('');
    const goals = S.goals.map((g) => {
      const p = Math.min(100, Math.round((g.saved / g.target) * 100)), { months, need } = Services.goalMonthly(g);
      return `<div class="card" data-act="editGoal" data-id="${g.id}" role="button" tabindex="0"><div class="top-row"><strong class="grow">${Utils.esc(g.name)}</strong><b>${p}%</b></div>
        <div class="progress" style="margin:8px 0" role="progressbar" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100"><i style="width:${p}%;background:var(--primary)"></i></div>
        <small>${UI.m(g.saved)} de ${UI.m(g.target)} · prazo ${Utils.fmtDate(g.deadline)}</small><br>
        <small>${g.saved >= g.target ? 'Meta atingida' : `Aportar <b>${UI.m(need)}</b>/mês por ${months} mês(es)`}</small>
        <div class="btn-row" style="margin-top:12px"><button class="btn" data-act="goalAdd" data-id="${g.id}">Guardar valor</button></div></div>`;
    }).join('');
    return `${C.header('Investimentos', { right: '<button class="icon-btn" data-act="newAsset" aria-label="Novo ativo" style="font-size:26px">+</button>' })}
    <div class="page">
      <section class="hero"><small>Patrimônio total</small><div class="big">${UI.m(pat)}</div>
        <div class="hero-sub"><span>Investido ${UI.m(inv)}</span><span>${ret >= 0 ? '▲' : '▼'} ${UI.m(ret)} (${pct.toFixed(1)}%)</span></div></section>
      <div class="card"><h3>Distribuição por tipo</h3><br>${Charts.donut(Services.distribution())}</div>
      <div class="card"><h3>Evolução</h3>${Charts.bars(Services.investEvolution(Utils.monthOf(Utils.today())), { aColor: '#007aff', two: false })}</div>
      <div class="section-h"><h2>Meus ativos</h2></div>
      <div class="list">${assets || C.empty('📈', 'Nenhum ativo ainda.')}</div>
      <div class="section-h"><h2>Metas</h2><button class="link" data-act="newGoal">+ Nova meta</button></div>
      <div class="list">${goals || C.empty('🎯', 'Crie uma meta de investimento.')}</div>
    </div>`;
  },
  ativo(id) {
    const a = State.data.assets.find((x) => x.id === id);
    if (!a) return C.header('Ativo', { back: true }) + C.empty('🤷', 'Ativo não encontrado.');
    const i = Services.invested(a), r = a.current - i, p = i > 0 ? (r / i) * 100 : 0;
    const moves = [...a.moves].sort((x, y) => y.date.localeCompare(x.date)).map((mv) => C.swipe('move', mv.id + '|' + a.id,
      `<div class="sw-front item"><div class="grow"><strong>${mv.kind === 'aporte' ? 'Aporte' : 'Resgate'}</strong><small>${Utils.fmtDate(mv.date)}</small></div><div class="right"><b>${mv.kind === 'aporte' ? '+' : '−'} ${UI.m(mv.amount)}</b></div></div>`)).join('');
    return `${C.header(Utils.esc(a.name), { back: true, right: `<button class="icon-btn" data-act="editAsset" data-id="${a.id}" aria-label="Editar">✎</button>` })}
    <div class="page">
      <section class="hero"><small>${Utils.esc(a.type)} · ${Utils.esc(a.inst || '—')}</small><div class="big">${UI.m(a.current)}</div>
        <div class="hero-sub"><span>Investido ${UI.m(i)}</span><span>${r >= 0 ? '▲' : '▼'} ${UI.m(r)} (${p.toFixed(1)}%)</span></div></section>
      <div class="btn-row"><button class="btn primary" data-act="newMove" data-id="${a.id}" data-kind="aporte">Aportar</button><button class="btn" data-act="newMove" data-id="${a.id}" data-kind="resgate">Resgatar</button></div>
      <button class="btn block" data-act="assetValue" data-id="${a.id}">Atualizar valor atual</button>
      <div class="section-h"><h2>Histórico</h2></div>
      <div class="list">${moves || C.empty('🧾', 'Sem movimentações.')}</div>
    </div>`;
  },

  /* ---------- Mais ---------- */
  mais() {
    const S = State.data, t = S.settings, can = UI.deferredPrompt || (Views.isIOS() && !Views.standalone());
    const row = (act, icon, title, sub = '', cls = '') => `<button type="button" data-act="${act}" class="${cls}"><span class="mi">${icon}</span><span class="grow"><strong>${title}</strong>${sub ? `<small>${sub}</small>` : ''}</span></button>`;
    return `${C.header('Ajustes')}
    <div class="page">
      <div class="group-h">Relatórios e dados</div>
      <div class="card menu">
        <a class="menu-row" href="#/relatorios"><span class="mi">📊</span><span class="grow"><strong>Relatórios</strong><small>Receitas e contas por período</small></span></a>
        ${row('exportCSV', '📄', 'Exportar CSV', 'Todas as contas e receitas')}
      </div>
      <div class="group-h">Backup</div>
      <div class="card menu">
        ${row('backup', '💾', 'Exportar backup (JSON)', t.lastBackup ? 'Último: ' + Utils.fmtDate(t.lastBackup.slice(0, 10)) : 'Nunca exportado')}
        ${row('restore', '📥', 'Restaurar backup', 'Selecione um arquivo .json')}
      </div>
      <div class="group-h">Preferências</div>
      <div class="card" style="display:grid;gap:14px">
        <div class="field"><span class="lbl">Tema</span><div class="seg">${[['auto', 'Sistema'], ['light', 'Claro'], ['dark', 'Escuro']].map(([v, n]) => `<button type="button" class="${t.theme === v ? 'on' : ''}" data-act="setTheme" data-v="${v}">${n}</button>`).join('')}</div></div>
        <label class="check"><input type="checkbox" data-act="toggleHide" ${t.hide ? 'checked' : ''}> Ocultar valores</label>
      </div>
      ${can ? `<div class="card menu">${row('install', '📲', 'Instalar app', 'Use como aplicativo, até offline')}</div>` : ''}
      <div class="group-h">Dados</div>
      <div class="card menu">
        ${row('sample', '🧪', 'Carregar dados de exemplo', 'Substitui os dados atuais')}
        ${row('clearAll', '🗑️', 'Limpar todos os dados', 'Ação irreversível (faça backup antes)', 'danger')}
      </div>
      <p class="muted" style="text-align:center">Meu Financeiro · seus dados ficam só neste aparelho.</p>
    </div>`;
  },
  relatorios() {
    const cur = Utils.monthOf(Utils.today());
    const r = UI.rep || (UI.rep = { from: Utils.addMonths(cur, -5), to: cur, cat: '' });
    if (r.from > r.to) [r.from, r.to] = [r.to, r.from];
    Services.ensureRange(r.from, r.to);
    const bills = State.data.bills.filter((b) => b.month >= r.from && b.month <= r.to);
    const incomes = State.data.incomes.filter((i) => i.month >= r.from && i.month <= r.to);
    const spent = Utils.sum(bills, (b) => Services.cost(b)), inc = Utils.sum(incomes, (i) => i.amount);
    const months = [];
    for (let m = r.from; m <= r.to && months.length < 60; m = Utils.addMonths(m, 1)) {
      const bs = bills.filter((b) => b.month === m);
      months.push({ m, exp: Utils.sum(bs, (b) => Services.cost(b)), inc: Utils.sum(incomes.filter((i) => i.month === m), (i) => i.amount) });
    }
    // Seletor de meses em português (últimos 24 e próximos 12)
    const monthOpts = (sel) => Array.from({ length: 37 }, (_, k) => Utils.addMonths(cur, k - 24)).map((m) => `<option value="${m}" ${m === sel ? 'selected' : ''}>${Utils.monthShort(m)}/${m.slice(2, 4)}</option>`).join('');
    return `${C.header('Relatórios', { back: true })}
    <div class="page">
      <div class="card" style="display:grid;gap:12px"><div class="row2">
        <div class="field"><label for="r-from">De</label><select id="r-from" data-rep="from">${monthOpts(r.from)}</select></div>
        <div class="field"><label for="r-to">Até</label><select id="r-to" data-rep="to">${monthOpts(r.to)}</select></div></div></div>
      <div class="card kv"><div><small>Receitas</small><b>${UI.m(inc)}</b></div><div><small>Despesas</small><b>${UI.m(spent)}</b></div><div><small>Saldo</small><b style="color:var(${inc - spent >= 0 ? '--ok' : '--bad'})">${UI.m(inc - spent)}</b></div><div><small>Média mensal</small><b>${UI.m(months.length ? Math.round(spent / months.length) : 0)}</b></div></div>
      <div class="card"><h3>Por mês</h3><table class="table"><tr><th>Mês</th><th>Receitas</th><th>Despesas</th></tr>${months.map((x) => `<tr><td>${Utils.monthShort(x.m)}/${x.m.slice(2, 4)}</td><td>${UI.m(x.inc)}</td><td>${UI.m(x.exp)}</td></tr>`).join('')}</table></div>
      <button class="btn primary block" data-act="exportPeriod">Exportar este período (CSV)</button>
    </div>`;
  },
  categorias() {
    return `${C.header('Tipos de despesa', { back: true, right: '<button class="icon-btn" data-act="newCat" aria-label="Novo tipo" style="font-size:26px">+</button>' })}
    <div class="page"><div class="list">${State.data.categories.map((c) => `<div class="card item" data-act="editCat" data-id="${c.id}" role="button" tabindex="0" style="padding:10px 14px"><span class="ico" style="background:${c.color}26">${c.icon}</span><strong class="grow">${Utils.esc(c.name)}</strong><span class="dot" style="background:${c.color};width:18px;height:18px"></span></div>`).join('')}</div></div>`;
  }
};


/* ================================ FORMS ================================= */
const Forms = {
  // Alternador Conta / Receita / Aporte no topo dos formulários de criação
  tabs(active) {
    return `<div class="seg" role="group" aria-label="Tipo de lançamento">${[['bill', 'Conta'], ['income', 'Receita'], ['move', 'Aporte']].map(([v, t]) => `<button type="button" class="${v === active ? 'on' : ''}" data-act="switchForm" data-v="${v}" aria-pressed="${v === active}">${t}</button>`).join('')}</div>`;
  },
  // Nomes já usados (mais recentes primeiro) para autopreencher novas contas
  knownBills() {
    const seen = new Map();
    for (const b of [...State.data.bills].reverse()) if (!seen.has(Utils.norm(b.name))) seen.set(Utils.norm(b.name), b);
    return seen;
  },
  // Conta: só nome, valor e Fixa/Variável. Fixa repete todo mês; variável vale só para o mês.
  // O vencimento é sempre o penúltimo dia do mês (day = 0).
  bill(b) {
    const edit = !!b;
    const v = b || { name: '', nature: 'fixa', planned: 0, paid: 0, status: 'pendente' };
    const known = edit ? new Map() : Forms.knownBills();
    const body = `${edit ? '' : Forms.tabs('bill')}
      ${UI.field('Nome', `<input id="f-name" name="name" value="${Utils.esc(v.name)}" maxlength="60" placeholder="Ex.: Aluguel" autocomplete="off" list="known-names">`, 'f-name')}
      <datalist id="known-names">${[...known.values()].map((x) => `<option value="${Utils.esc(x.name)}"></option>`).join('')}</datalist>
      ${UI.money('planned', 'Valor (R$)', v.planned)}
      ${UI.seg('nature', [{ v: 'fixa', t: 'Fixa' }, { v: 'variavel', t: 'Variável' }], v.nature, 'Tipo')}
      <p class="muted" data-hint></p>
      ${edit ? `<div class="btn-row"><button type="button" class="btn danger" data-act="delBill" data-id="${b.id}">Excluir</button></div>` : ''}`;
    UI.sheet({
      title: edit ? 'Editar conta' : 'Nova conta', body, submit: 'Salvar', focus: !edit,
      onMount(form) {
        const hint = form.querySelector('[data-hint]');
        const sync = () => { hint.textContent = UI.val(form, 'nature') === 'fixa' ? 'Repete todo mês, com o mesmo valor.' : 'Vale só para este mês.'; };
        form.querySelectorAll('[name=nature]').forEach((r) => r.addEventListener('change', sync));
        sync();
        if (edit) return;
        // Ao digitar um nome já usado, repete valor e tipo
        form.elements.name.addEventListener('input', () => {
          const k = known.get(Utils.norm(form.elements.name.value.trim()));
          if (!k || form.elements.planned.value) return;
          form.elements.planned.value = Utils.num(k.planned);
          form.querySelector(`[name=nature][value=${k.nature}]`).checked = true; sync();
        });
      },
      async onSubmit(form) {
        const g = (n) => UI.val(form, n).trim();
        const f = { name: g('name'), nature: g('nature'), planned: Utils.cents(g('planned')) };
        if (!f.name) return 'Informe o nome da conta.';
        if (f.planned <= 0) return 'Informe um valor maior que zero.';
        if (!edit) {
          Services.addBill({ ...f, cat: 'outros', day: 0, method: '', note: '', month: UI.month, rec: f.nature === 'fixa' ? 'mensal' : 'unica' });
          UI.commit('Conta adicionada ✓'); return true;
        }
        const scope = await UI.scope(b, 'Editar');
        if (!scope) return false;
        const snap = State.snapshot();
        Services.updateItem('bill', b.id, { name: f.name, nature: f.nature, planned: f.planned }, scope);
        UI.commit('Conta atualizada ✓', snap); return true;
      }
    });
  },
  // Receita: Salário (todo mês) ou A receber (de outras pessoas, só este mês)
  income(i) {
    const edit = !!i, v = i || { name: '', type: 'Salário', amount: 0, received: false };
    const kind = v.type === 'Salário' ? 'Salário' : 'A receber';
    const body = `${edit ? '' : Forms.tabs('income')}${UI.input('name', 'Descrição', v.name, 'maxlength="60" placeholder="Ex.: Salário" autocomplete="off"')}
      ${UI.money('amount', 'Valor (R$)', v.amount)}
      ${UI.seg('type', [{ v: 'Salário', t: 'Salário' }, { v: 'A receber', t: 'A receber' }], kind, 'Tipo')}
      <p class="muted" data-hint></p>
      ${edit ? `<label class="check"><input type="checkbox" name="received" ${v.received ? 'checked' : ''}> Já recebido</label>
      <button type="button" class="btn danger" data-act="delIncome" data-id="${i.id}">Excluir</button>` : ''}`;
    UI.sheet({
      title: edit ? 'Editar receita' : 'Nova receita', body, submit: 'Salvar', focus: !edit,
      onMount(form) {
        const hint = form.querySelector('[data-hint]');
        const sync = () => { hint.textContent = UI.val(form, 'type') === 'Salário' ? 'Repete todo mês.' : 'Valor que outra pessoa vai te pagar, só neste mês.'; };
        form.querySelectorAll('[name=type]').forEach((r) => r.addEventListener('change', sync));
        sync();
      },
      async onSubmit(form) {
        const g = (n) => UI.val(form, n).trim();
        const f = { name: g('name'), type: g('type'), amount: Utils.cents(g('amount')) };
        if (!f.name) return 'Informe a descrição.';
        if (f.amount <= 0) return 'Informe um valor maior que zero.';
        if (!edit) {
          Services.addIncome({ ...f, day: 0, date: Utils.dueDate(UI.month, 0), rec: f.type === 'Salário' ? 'fixa' : 'variavel', received: false });
          UI.commit('Receita adicionada ✓'); return true;
        }
        const scope = await UI.scope(i, 'Editar');
        if (!scope) return false;
        const snap = State.snapshot();
        Services.updateItem('income', i.id, { name: f.name, type: f.type, amount: f.amount, received: form.elements.received.checked }, scope);
        UI.commit('Receita atualizada ✓', snap); return true;
      }
    });
  },
  pay(id) {
    const b = State.data.bills.find((x) => x.id === id);
    UI.sheet({
      title: 'Registrar pagamento',
      body: `<p><strong>${Utils.esc(b.name)}</strong><br><small>Previsto ${Utils.money(b.planned)} · vence ${Utils.fmtDM(Utils.dueDate(b.month, b.day))}</small></p>
        ${UI.money('amount', 'Valor pago (R$)', b.status === 'parcial' ? b.paid : b.planned)}
        <label class="check"><input type="checkbox" name="settle"> Quitar mesmo se for menor que o previsto</label>`,
      submit: 'Confirmar pagamento',
      onSubmit(form) {
        const amount = Utils.cents(UI.val(form, 'amount'));
        if (amount <= 0) return 'Informe o valor pago.';
        const snap = State.snapshot();
        Services.pay(id, amount, form.elements.settle.checked);
        UI.commit('Pagamento registrado ✓', snap); return true;
      }
    });
  },
  move(assetId, kind = 'aporte', withTabs = false) {
    const assets = State.data.assets;
    if (!assets.length) { UI.toast('Cadastre um ativo primeiro.'); return Forms.asset(); }
    const body = `${withTabs ? Forms.tabs('move') : ''}${UI.seg('kind', [{ v: 'aporte', t: 'Aporte' }, { v: 'resgate', t: 'Resgate' }], kind, 'Operação')}
      ${UI.select('asset', 'Ativo', [...assets.map((a) => ({ v: a.id, t: a.name })), { v: '__new', t: '➕ Novo ativo…' }], assetId || assets[0].id)}
      ${UI.money('amount', 'Valor (R$)', 0)}${UI.field('Data', `<input id="f-date" name="date" type="date" value="${Utils.today()}">`, 'f-date')}`;
    UI.sheet({
      title: 'Aporte / resgate', body, submit: 'Salvar',
      onSubmit(form) {
        const id = UI.val(form, 'asset'), k = UI.val(form, 'kind'), amount = Utils.cents(UI.val(form, 'amount')), date = UI.val(form, 'date');
        if (id === '__new') { UI.closeHost('#sheet'); setTimeout(() => Forms.asset(), 220); return false; }
        if (amount <= 0) return 'Informe um valor maior que zero.';
        if (!date) return 'Informe a data.';
        const a = assets.find((x) => x.id === id);
        if (k === 'resgate' && amount > a.current) return 'O resgate é maior que o valor atual do ativo.';
        Services.addMove(id, k, amount, date);
        UI.commit(k === 'aporte' ? 'Aporte registrado ✓' : 'Resgate registrado ✓'); return true;
      }
    });
  },
  asset(a) {
    const edit = !!a;
    const body = `${UI.input('name', 'Nome do ativo', a ? a.name : '', 'maxlength="60" placeholder="Ex.: Tesouro Selic 2029" autocomplete="off"')}
      ${UI.input('inst', 'Instituição', a ? a.inst : '', 'maxlength="40" placeholder="Ex.: Nubank" autocomplete="off"')}
      ${UI.select('type', 'Tipo', ASSET_TYPES, a ? a.type : 'Renda fixa')}
      ${edit ? '' : `${UI.money('invested', 'Valor investido (R$)', 0)}${UI.field('Data do investimento', `<input id="f-date" name="date" type="date" value="${Utils.today()}">`, 'f-date')}${UI.money('current', 'Valor atual (R$) — opcional', 0)}`}
      ${edit ? `<button type="button" class="btn danger" data-act="delAsset" data-id="${a.id}">Excluir ativo</button>` : ''}`;
    UI.sheet({
      title: edit ? 'Editar ativo' : 'Novo ativo', body, submit: 'Salvar',
      onSubmit(form) {
        const g = (n) => UI.val(form, n).trim(), name = g('name');
        if (!name) return 'Informe o nome do ativo.';
        if (edit) { Object.assign(a, { name, inst: g('inst'), type: g('type') }); State.save(); UI.commit('Ativo atualizado ✓'); return true; }
        const invested = Utils.cents(g('invested')), current = Utils.cents(g('current')) || invested;
        if (invested <= 0) return 'Informe o valor investido.';
        if (!g('date')) return 'Informe a data.';
        Services.addAsset({ name, inst: g('inst'), type: g('type'), invested, current, date: g('date') });
        UI.commit('Ativo criado ✓'); return true;
      }
    });
  },
  assetValue(id) {
    const a = State.data.assets.find((x) => x.id === id);
    UI.sheet({
      title: 'Atualizar valor atual', body: `<p class="muted">${Utils.esc(a.name)}</p>${UI.money('current', 'Valor atual (R$)', a.current)}`, submit: 'Salvar',
      onSubmit(form) {
        const v = Utils.cents(UI.val(form, 'current'));
        if (v < 0) return 'Valor inválido.';
        a.current = v; State.save(); UI.commit('Valor atualizado ✓'); return true;
      }
    });
  },
  goal(g) {
    const edit = !!g;
    const body = `${UI.input('name', 'Nome da meta', g ? g.name : '', 'maxlength="60" placeholder="Ex.: Reserva de emergência" autocomplete="off"')}
      ${UI.money('target', 'Valor da meta (R$)', g ? g.target : 0)}${UI.money('saved', 'Já guardado (R$)', g ? g.saved : 0)}
      ${UI.field('Prazo', `<input id="f-deadline" name="deadline" type="date" value="${g ? g.deadline : ''}">`, 'f-deadline')}
      ${edit ? `<button type="button" class="btn danger" data-act="delGoal" data-id="${g.id}">Excluir meta</button>` : ''}`;
    UI.sheet({
      title: edit ? 'Editar meta' : 'Nova meta', body, submit: 'Salvar',
      onSubmit(form) {
        const f = { name: UI.val(form, 'name').trim(), target: Utils.cents(UI.val(form, 'target')), saved: Utils.cents(UI.val(form, 'saved')), deadline: UI.val(form, 'deadline') };
        if (!f.name) return 'Informe o nome da meta.';
        if (f.target <= 0) return 'Informe o valor da meta.';
        if (!f.deadline || f.deadline <= Utils.today()) return 'Informe um prazo futuro.';
        if (edit) Object.assign(g, f); else State.data.goals.push({ id: Utils.uid(), ...f });
        State.save(); UI.commit('Meta salva ✓'); return true;
      }
    });
  },
  goalAdd(id) {
    const g = State.data.goals.find((x) => x.id === id);
    UI.sheet({
      title: 'Guardar para a meta', body: `<p class="muted">${Utils.esc(g.name)}</p>${UI.money('amount', 'Valor (R$)', Services.goalMonthly(g).need)}`, submit: 'Adicionar',
      onSubmit(form) {
        const v = Utils.cents(UI.val(form, 'amount'));
        if (v <= 0) return 'Informe um valor maior que zero.';
        g.saved += v; State.save(); UI.commit('Valor adicionado à meta ✓'); return true;
      }
    });
  },
  cat(id) {
    const c = id ? State.data.categories.find((x) => x.id === id) : null, v = c || { name: '', color: '#7c3aed', icon: '📦' };
    const body = `${UI.input('name', 'Nome', v.name, 'maxlength="30" autocomplete="off"')}
      ${UI.field('Cor', `<input id="f-color" name="color" type="color" value="${v.color}">`, 'f-color')}
      <div class="field"><span class="lbl">Ícone</span><div class="emoji-grid">${EMOJIS.map((e) => `<label><input type="radio" name="icon" value="${e}" ${e === v.icon ? 'checked' : ''}><span>${e}</span></label>`).join('')}</div></div>
      ${c && c.id !== 'outros' ? `<button type="button" class="btn danger" data-act="delCat" data-id="${c.id}">Excluir tipo</button>` : ''}`;
    UI.sheet({
      title: c ? 'Editar tipo' : 'Novo tipo', body, submit: 'Salvar',
      onSubmit(form) {
        const f = { name: UI.val(form, 'name').trim(), color: UI.val(form, 'color'), icon: (form.querySelector('[name=icon]:checked') || {}).value || '📦' };
        if (!f.name) return 'Informe o nome do tipo.';
        if (State.data.categories.some((x) => x.id !== (c && c.id) && Utils.norm(x.name) === Utils.norm(f.name))) return 'Já existe um tipo com esse nome.';
        if (c) Object.assign(c, f); else State.data.categories.push({ id: Utils.uid(), ...f });
        State.save(); UI.commit('Tipo salvo ✓'); return true;
      }
    });
  }
};

/* =============================== ACTIONS ================================ */
// Exclusão genérica com confirmação e desfazer
async function remove(kind, id) {
  const S = State.data; let scope = 'one';
  if (kind === 'bill' || kind === 'income') {
    const item = Services.collection(kind).find((x) => x.id === id);
    if (item.series) { scope = await UI.scope(item, 'Excluir'); if (!scope) return; } else if (!(await UI.confirmDel(`Excluir "${item.name}"?`))) return;
  } else if (!(await UI.confirmDel('Esta ação pode ser desfeita logo após.'))) return;
  const snap = State.snapshot();
  if (kind === 'bill' || kind === 'income') Services.removeItem(kind, id, scope);
  else if (kind === 'asset') { S.assets = S.assets.filter((a) => a.id !== id); if (location.hash.startsWith('#/ativo')) location.hash = '#/invest'; }
  else if (kind === 'goal') S.goals = S.goals.filter((g) => g.id !== id);
  else if (kind === 'cat') { S.bills.forEach((b) => { if (b.cat === id) b.cat = 'outros'; }); S.series.forEach((s) => { if (s.tpl.cat === id) s.tpl.cat = 'outros'; }); S.categories = S.categories.filter((c) => c.id !== id); }
  else if (kind === 'move') { const [mid, aid] = id.split('|'); Services.removeMove(aid, mid); }
  State.save();
  UI.closeHost('#sheet');
  UI.commit('Excluído', snap);
}

const Actions = {
  back: () => (history.length > 1 ? history.back() : (location.hash = '#/mais')),
  prevMonth: () => UI.shift(-1), nextMonth: () => UI.shift(1),
  goToday() { UI.month = Utils.monthOf(Utils.today()); UI.refresh(); },
  closeSheet: () => UI.closeHost('#sheet'), closeDialog() { UI.dialogResolve ? UI.dialogResolve(null) : UI.closeHost('#dialog'); },
  toggleHide() { State.data.settings.hide = !State.data.settings.hide; State.save(); UI.refresh(); },
  openAdd: () => Forms.bill(),
  switchForm(d) { if (d.v === 'bill') Forms.bill(); else if (d.v === 'income') Forms.income(); else Forms.move(null, 'aporte', true); },
  newMove(d) { Forms.move(d.id, d.kind); },
  // Um toque: paga o valor previsto (fixa), pede o valor real (variável) ou desfaz
  quickPay(d) {
    const b = State.data.bills.find((x) => x.id === d.id);
    if (!b) return;
    const snap = State.snapshot();
    if (b.status === 'pago') { Services.pay(b.id, 0); UI.commit('Pagamento desfeito', snap); }
    else if (b.nature === 'variavel') Forms.pay(b.id);
    else { Services.pay(b.id, b.planned, true); UI.commit('Conta paga ✓', snap); }
  },
  quickReceive(d) { const snap = State.snapshot(); Services.toggleReceived(d.id); UI.commit('Receita atualizada', snap); },
  toggleSearch() { UI.f.search = !UI.f.search; UI.f.q = ''; UI.refresh(); },
  editBill(d) { Forms.bill(State.data.bills.find((b) => b.id === d.id)); },
  editIncome(d) { Forms.income(State.data.incomes.find((i) => i.id === d.id)); },
  pay(d) { UI.closeHost('#sheet'); setTimeout(() => Forms.pay(d.id), UI.cur ? 200 : 0); },
  delBill: (d) => remove('bill', d.id), delIncome: (d) => remove('income', d.id), delAsset: (d) => remove('asset', d.id),
  delGoal: (d) => remove('goal', d.id), delCat: (d) => remove('cat', d.id),
  newAsset: () => Forms.asset(), editAsset: (d) => Forms.asset(State.data.assets.find((a) => a.id === d.id)),
  assetValue: (d) => Forms.assetValue(d.id), newGoal: () => Forms.goal(), editGoal: (d) => Forms.goal(State.data.goals.find((g) => g.id === d.id)),
  goalAdd: (d) => Forms.goalAdd(d.id), newCat: () => Forms.cat(), editCat: (d) => Forms.cat(d.id),
  setFilter(d) { UI.f[d.k] = d.v; UI.refresh(); },
  setTheme(d) { State.data.settings.theme = d.v; State.save(); UI.applyTheme(); UI.refresh(); },
  exportCSV() { Utils.download(`financeiro-${Utils.today()}.csv`, Services.csv('0000-01', '9999-12'), 'text/csv;charset=utf-8'); UI.toast('CSV exportado'); },
  exportPeriod() { const r = UI.rep; Utils.download(`relatorio-${r.from}_${r.to}.csv`, Services.csv(r.from, r.to, r.cat), 'text/csv;charset=utf-8'); UI.toast('CSV exportado'); },
  backup() {
    State.data.settings.lastBackup = new Date().toISOString(); State.save();
    Utils.download(`financeiro-backup-${Utils.today()}.json`, JSON.stringify(State.data, null, 2), 'application/json');
    UI.toast('Backup exportado ✓'); UI.refresh();
  },
  restore: () => UI.$('#file').click(),
  async sample() {
    if (!(await UI.choose('Carregar exemplo?', 'Isso substitui TODOS os dados atuais pelos de exemplo.', [{ v: 'ok', t: 'Substituir dados', cls: 'danger' }]))) return;
    const snap = State.snapshot(); Services.loadSample(); UI.commit('Dados de exemplo carregados', snap);
  },
  async clearAll() {
    if (!(await UI.choose('Limpar tudo?', 'Todas as contas, receitas e investimentos serão apagados.', [{ v: 'ok', t: 'Apagar tudo', cls: 'danger' }]))) return;
    const snap = State.snapshot(), keep = State.data.settings;
    State.data = State.defaults(); State.data.settings = { ...keep, lastBackup: null }; State.save();
    UI.commit('Dados apagados', snap);
  },
  async install() {
    if (UI.deferredPrompt) { UI.deferredPrompt.prompt(); await UI.deferredPrompt.userChoice; UI.deferredPrompt = null; UI.refresh(); }
    else UI.choose('Instalar no iPhone', 'Toque no botão Compartilhar do Safari e escolha "Adicionar à Tela de Início".', []);
  },
  dismissInstall() { State.data.settings.installDismissed = true; State.save(); UI.refresh(); },
  dismissTip() { State.data.settings.swipeSeen = true; State.save(); UI.refresh(); },
  // Gesto de deslizar: 'r' = para a direita (pagar/receber), 'l' = para a esquerda (excluir)
  swipe(kind, id, dir) {
    if (!State.data.settings.swipeSeen) { State.data.settings.swipeSeen = true; State.save(); }
    if (dir === 'l') return remove(kind, id);
    if (kind === 'bill') Actions.quickPay({ id });
    else if (kind === 'income') Actions.quickReceive({ id });
  }
};

/* ============================== EVENTOS ================================= */
function bindEvents() {
  // Linha divisória no cabeçalho só depois de rolar
  window.addEventListener('scroll', () => {
    document.querySelector('.top')?.classList.toggle('scrolled', window.scrollY > 4);
  }, { passive: true });
  // Cliques por delegação (data-act)
  document.addEventListener('click', (e) => {
    const choice = e.target.closest('[data-choice]');
    if (choice && UI.dialogResolve) return UI.dialogResolve(choice.dataset.choice);
    if (Date.now() < UI.noClick) return;
    const el = e.target.closest('[data-act]');
    if (!el || el.matches('input[type=checkbox]') && e.type !== 'click') return;
    const fn = Actions[el.dataset.act];
    if (fn) { if (el.tagName === 'A') e.preventDefault(); fn(el.dataset, el); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (UI.$('#dialog').innerHTML) Actions.closeDialog(); else if (UI.$('#sheet').innerHTML) Actions.closeSheet(); }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role=button][data-act]')) { e.preventDefault(); e.target.click(); }
  });
  // Envio de formulários dos sheets
  document.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ctx = UI.cur;
    if (!ctx || !ctx.onSubmit || e.target !== ctx.form) return;
    const err = ctx.form.querySelector('.form-err'); err.textContent = '';
    const r = await ctx.onSubmit(ctx.form);
    if (r === true) UI.closeHost('#sheet'); else if (typeof r === 'string') { err.textContent = r; err.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  });
  // Máscara de moeda, busca e filtros
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.classList.contains('money')) { const d = t.value.replace(/\D/g, '').slice(0, 12); t.value = d ? Utils.num(Number(d)) : ''; }
    else if (t.matches('[data-q]')) { UI.f.q = t.value; UI.$('#bill-list').innerHTML = Views.listHtml(); }
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-rep]')) { UI.rep[t.dataset.rep] = t.value || UI.rep[t.dataset.rep]; UI.refresh(); }
  });
  UI.$('#file').addEventListener('change', async (e) => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!State.isValid(data)) throw new Error('inválido');
      if (!(await UI.choose('Restaurar backup?', 'Os dados atuais serão substituídos pelo conteúdo do arquivo.', [{ v: 'ok', t: 'Restaurar', cls: 'primary' }]))) return;
      const snap = State.snapshot();
      State.data = { ...State.defaults(), ...data, settings: { ...State.defaults().settings, ...data.settings } }; State.save();
      UI.applyTheme(); UI.commit('Backup restaurado ✓', snap);
    } catch { UI.toast('Arquivo de backup inválido.'); }
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => UI.applyTheme());
  window.addEventListener('hashchange', () => UI.render(true));
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); UI.deferredPrompt = e; if (UI.route().name === 'inicio') UI.refresh(); });
  window.addEventListener('appinstalled', () => { UI.deferredPrompt = null; UI.toast('App instalado ✓'); });
  initGestures();
}

// Gestos: deslizar itens (pagar/excluir) e deslizar a barra de mês
function initGestures() {
  let st = null;
  document.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, input, select, a, textarea')) return;
    const front = e.target.closest('.sw-front'), ms = e.target.closest('[data-mswipe]');
    if (!front && !ms) return;
    st = { x: e.clientX, y: e.clientY, front, ms, dx: 0, active: false };
  });
  document.addEventListener('pointermove', (e) => {
    if (!st) return;
    const dx = e.clientX - st.x, dy = e.clientY - st.y;
    if (!st.active) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { st = null; return; }
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        st.active = true;
        if (st.front) { st.front.classList.add('dragging'); st.front.parentElement.classList.toggle('r', dx > 0); st.front.parentElement.classList.toggle('l', dx < 0); }
      }
    }
    if (st.active && st.front) {
      st.dx = Math.max(-140, Math.min(140, dx));
      st.front.parentElement.classList.toggle('r', st.dx > 0); st.front.parentElement.classList.toggle('l', st.dx < 0);
      st.front.style.transform = `translateX(${st.dx}px)`;
    }
    if (st.active && st.ms && !st.front) st.dx = dx;
  });
  const end = (cancel) => {
    if (!st) return;
    const s = st; st = null;
    if (!s.active) return;
    UI.noClick = Date.now() + 350;
    if (s.front) {
      s.front.classList.remove('dragging'); s.front.style.transform = '';
      const box = s.front.parentElement;
      if (!cancel && Math.abs(s.dx) >= 90) { UI.vibe(); Actions.swipe(box.dataset.kind, box.dataset.id, s.dx > 0 ? 'r' : 'l'); }
    } else if (!cancel && Math.abs(s.dx) > 70) UI.shift(s.dx > 0 ? -1 : 1);
  };
  document.addEventListener('pointerup', () => end(false));
  document.addEventListener('pointercancel', () => end(true));
}

/* ============================ PWA / INICIAR ============================= */
// iOS não aceita ícone SVG: gera um PNG em tempo de execução para o apple-touch-icon
function setAppleIcon() {
  const img = new Image();
  img.onload = () => {
    const c = Object.assign(document.createElement('canvas'), { width: 180, height: 180 });
    c.getContext('2d').drawImage(img, 0, 0, 180, 180);
    try { document.getElementById('apple-icon').href = c.toDataURL('image/png'); } catch { /* ignora */ }
  };
  img.src = 'icons/icon.svg';
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  let reloading = false;
  // Atualização automática: quando um novo SW assume, recarrega uma vez
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloading || !hadController) return; reloading = true; location.reload(); });
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then((reg) => reg.update()).catch(() => { /* ignora (ex.: file://) */ });
}

function start() {
  State.init();
  UI.applyTheme();
  bindEvents();
  if (!location.hash) location.hash = '#/inicio';
  UI.render(true);
  Storage.persist();
  setAppleIcon();
  registerSW();
}
start();
