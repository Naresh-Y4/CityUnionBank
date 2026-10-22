/* Educational ATM simulator. NOT secure: never use for real PINs or money. */
(() => {
  'use strict';

  /* ---------- Demo rules ---------- */
  const C = { RETURN: 8000, PROCESS: 1800, RECEIPT: 1400, COLLECT: 12000, IDLE: 90000,
              UNIT: 100, MAX_WD: 20000, MAX_DEP: 50000, TRIES: 3, RECENT: 3 };   // UNIT = 1 removes the multiples-of-100 rule
  const SAMPLE = ['01 JUL Deposite Rs:5000', '03 JUL withdraw Rs:1000', '05 JUL Balance Rs:4000'];
  const PROTECTED = new Set(['menu','withdraw','confirm','processing','collect','receiptq','another','balance','changepin','statement','deposit','transfer','success']);
  const TERMINAL = ['success', 'cancel', 'blocked'];

  /* ---------- State (kept separate, memory only) ---------- */
  const account = { pin: '1234', balance: 25000 };
  const session = { authenticated: false, cardIn: false, pinTries: 0 };
  const history = [];
  const ui = { screen: 'welcome', timer: null, idle: null, busy: false, printing: false, pending: null, receipt: null };

  const $ = (id) => document.getElementById(id);
  const screens = document.querySelectorAll('.screen');
  const forms = document.querySelectorAll('form.screen');
  const card = $('card'), cash = $('cash'), paper = $('paper');
  const currentScreen = () => document.querySelector('.screen:not([hidden])');

  /* ---------- Navigation ---------- */
  function showScreen(name) {
    if (name === 'welcome') resetSession();
    else if (PROTECTED.has(name) && !session.authenticated) { name = 'welcome'; resetSession(); }

    clearTimeout(ui.timer); ui.timer = null;
    document.querySelectorAll('.msg').forEach((m) => { m.textContent = ''; });
    document.querySelectorAll('[aria-invalid]').forEach((i) => i.removeAttribute('aria-invalid'));
    forms.forEach((f) => f.reset());
    screens.forEach((s) => { s.hidden = s.dataset.screen !== name; });
    ui.screen = name; ui.busy = false;

    if (enter[name]) enter[name]();
    if (TERMINAL.includes(name)) ui.timer = setTimeout(() => showScreen('welcome'), C.RETURN);
    resetIdle();

    const h = document.querySelector(`[data-screen="${name}"] h1`);
    if (h) h.focus();
  }

  function resetSession() {
    session.authenticated = false; session.pinTries = 0; session.cardIn = false;
    ui.pending = null; ui.receipt = null;
    setCard('idle'); cash.hidden = true; paper.hidden = true;
  }

  function resetIdle() {
    clearTimeout(ui.idle);
    if (ui.screen !== 'welcome' && !TERMINAL.includes(ui.screen)) ui.idle = setTimeout(() => showScreen('cancel'), C.IDLE);
  }
  ['pointerdown', 'keydown'].forEach((t) => document.addEventListener(t, resetIdle));

  const enter = {
    balance: () => { $('balance-text').textContent = 'Avilable Balance:' + account.balance; },
    statement: renderStatement,
    confirm: () => {
      const box = $('confirm-lines'); box.replaceChildren();
      txnLines(ui.pending).forEach((l) => { const p = document.createElement('p'); p.textContent = l; box.appendChild(p); });
    },
    processing: () => { ui.timer = setTimeout(finishTxn, C.PROCESS); },
    collect: () => { showCash(ui.pending.amount); ui.timer = setTimeout(takeCash, C.COLLECT); },
    success: ejectCard,
    cancel: () => { ui.pending = null; ejectCard(); }
  };

  function showError(id, text, input) {
    $(id).textContent = text;
    if (input) { input.setAttribute('aria-invalid', 'true'); input.focus(); }
  }

  /* ---------- Validation ---------- */
  const isFourDigits = (v) => /^\d{4}$/.test(v);

  function parseAmount(raw) {
    const v = raw.trim();
    if (!v) return { error: 'Please enter an amount.' };
    if (v[0] === '-') return { error: 'Amount must be greater than zero.' };
    if (/^\d*\.\d*$/.test(v)) return { error: 'Enter a whole-rupee amount without decimals.' };
    if (!/^\d+$/.test(v)) return { error: 'Enter numbers only.' };
    if (v.length > 9) return { error: 'Amount is too large.' };
    const n = Number(v);
    return n === 0 ? { error: 'Amount must be greater than zero.' } : { amount: n };
  }
  function checkUnit(r) {
    return r.amount % C.UNIT ? { error: `Enter an amount in multiples of ${C.UNIT}.` } : r;
  }
  function validateWithdrawal(raw) {
    const r = parseAmount(raw);
    if (r.error) return r;
    if (r.amount > account.balance) return { error: 'Insufficient balance.' };
    if (r.amount > C.MAX_WD) return { error: `Maximum per transaction is Rs:${C.MAX_WD}.` };
    return checkUnit(r);
  }
  function validateDeposit(raw) {
    const r = parseAmount(raw);
    if (r.error) return r;
    if (r.amount > C.MAX_DEP) return { error: `Maximum per deposit is Rs:${C.MAX_DEP}.` };
    return checkUnit(r);
  }
  function validateTransfer(acct, raw) {
    if (!/^\d{10}$/.test(acct)) return { field: 'tr-account', error: 'Account number must be exactly 10 digits.' };
    const r = parseAmount(raw);
    if (r.error) return { field: 'tr-amount', error: r.error };
    if (r.amount > account.balance) return { field: 'tr-amount', error: 'Insufficient balance.' };
    return { amount: r.amount };
  }
  function validatePinChange(cur, next, rep) {
    if (cur !== account.pin) return { field: 'pc-current', error: 'Current PIN is incorrect.' };
    if (!isFourDigits(next)) return { field: 'pc-new', error: 'New PIN must be exactly four digits.' };
    if (rep !== next) return { field: 'pc-repeat', error: 'New PIN entries do not match.' };
    return { ok: true };
  }

  /* ---------- Transactions ---------- */
  function txnLines(p) {
    if (p.type === 'withdraw') return ['Cash Withdrawl', 'Amount: Rs:' + p.amount];
    if (p.type === 'deposit') return ['Cash Deposite', 'Amount: Rs:' + p.amount];
    return ['Fund Transfer', 'To Account:' + p.acct, 'Amount: Rs:' + p.amount];
  }
  function beginTxn(p) { ui.pending = p; showScreen('confirm'); }

  function applyTxn(p) {                       // returns false if it can no longer be done
    if (p.type !== 'deposit' && p.amount > account.balance) return false;
    account.balance += p.type === 'deposit' ? p.amount : -p.amount;
    history.push({ date: new Date(), label: p.type === 'deposit' ? 'Deposite' : p.type === 'withdraw' ? 'withdraw' : 'transfer', amount: p.amount });
    return true;
  }

  function finishTxn() {
    const p = ui.pending;
    if (!p || !applyTxn(p)) return showScreen('cancel');
    ui.receipt = makeReceipt(txnLines(p).concat('Avilable Balance:' + account.balance));
    showScreen(p.type === 'withdraw' ? 'collect' : 'receiptq');
  }

  function processPinChange(pin) { account.pin = pin; }   // not a financial transaction

  /* ---------- Statement and receipts ---------- */
  function formatDate(d) {
    return String(d.getDate()).padStart(2, '0') + ' ' + d.toLocaleString('en-GB', { month: 'short' }).toUpperCase().replace('.', '');
  }
  function statementLines() {
    return SAMPLE.concat(history.slice(-C.RECENT).map((h) => `${formatDate(h.date)} ${h.label} Rs:${h.amount}`));
  }
  function renderStatement() {
    const ul = $('statement-list'); ul.replaceChildren();
    statementLines().forEach((l) => { const li = document.createElement('li'); li.textContent = l; ul.appendChild(li); });
  }
  const makeReceipt = (lines) => ({ lines, date: new Date().toLocaleString() });

  function renderReceipt(el, r) {
    el.replaceChildren();
    const add = (tag, t) => { const n = document.createElement(tag); n.textContent = t; el.appendChild(n); };
    add('h3', 'CITY UNION BANK LTD');
    r.lines.forEach((l, i) => add(i === 0 ? 'h4' : 'p', l));
    add('p', 'Date: ' + r.date);
  }

  /* ---------- Hardware: card, cash, receipt ---------- */
  function setCard(state) {
    card.className = 'card ' + state;
    card.setAttribute('aria-label', state === 'out' ? 'Remove card' : 'Insert card');
  }
  function insertCard() {
    if (ui.screen !== 'welcome' || ui.busy) return;
    ui.busy = true; session.cardIn = true; setCard('in');
    setTimeout(() => { if (ui.screen === 'welcome') showScreen('pin'); }, 700);
  }
  function ejectCard() { if (session.cardIn) setCard('out'); }
  card.addEventListener('click', () => {
    if (card.classList.contains('out')) { session.cardIn = false; setCard('idle'); }
    else if (card.classList.contains('idle')) insertCard();
  });

  function showCash(amount) {
    cash.setAttribute('aria-label', 'Collect cash Rs:' + amount);
    cash.hidden = false;
    cash.style.animation = 'none'; void cash.offsetWidth; cash.style.animation = '';
  }
  function takeCash() {
    if (cash.hidden) return;
    cash.hidden = true;
    if (ui.screen === 'collect') showScreen('receiptq');
  }
  cash.addEventListener('click', takeCash);

  function printReceipt(r, done) {
    ui.receipt = r;
    renderReceipt($('paper-body'), r);
    paper.hidden = false;
    paper.style.animation = 'none'; void paper.offsetWidth; paper.style.animation = '';
    setTimeout(done, C.RECEIPT);
  }
  paper.addEventListener('click', () => {      // taking the paper opens the browser print dialog
    if (ui.printing || !ui.receipt) return;
    renderReceipt($('receipt'), ui.receipt);
    ui.printing = true;
    window.print();
  });
  window.addEventListener('afterprint', () => { ui.printing = false; $('receipt').replaceChildren(); });

  /* ---------- Keys and keypad ---------- */
  function pressKey(k) {
    const el = document.querySelector(`.screen:not([hidden]) [data-key="${k}"]`);
    if (el && !el.disabled) el.click();
  }
  function pressCancel() {
    if (ui.screen === 'welcome' || ui.screen === 'processing' || TERMINAL.includes(ui.screen)) return;
    showScreen('cancel');
  }
  function activeInput() {
    const s = currentScreen(), a = document.activeElement;
    return a && a.tagName === 'INPUT' && s.contains(a) ? a : s.querySelector('input');
  }
  function typeDigit(d) {
    const i = activeInput();
    if (!i || i.value.length >= i.maxLength) return;
    i.value += d; i.focus();
    if (i.id === 'tr-account' && i.value.length === 10) $('tr-amount').focus();
  }
  document.querySelectorAll('.sk').forEach((b) => {
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => pressKey(b.dataset.sk));
  });
  $('keypad').addEventListener('mousedown', (e) => e.preventDefault());
  $('keypad').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pad]');
    if (!b) return;
    const k = b.dataset.pad, s = currentScreen();
    if (/^\d$/.test(k)) typeDigit(k);
    else if (k === 'clear') { const i = activeInput(); if (i) { i.value = ''; i.focus(); } }
    else if (k === 'cancel') pressCancel();
    else if (s.matches('form')) s.requestSubmit();
    else if (ui.screen === 'welcome') insertCard();
    else if (ui.screen === 'collect') takeCash();
  });
  document.addEventListener('click', (e) => { if (e.target.closest('[data-cancel]')) pressCancel(); });

  /* ---------- Welcome ---------- */
  $('cardless').addEventListener('click', () => { if (ui.screen === 'welcome') showScreen('pin'); });
  document.querySelector('[data-screen="welcome"]').addEventListener('click', (e) => { if (!e.target.closest('button')) insertCard(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') return pressCancel();
    if (ui.screen === 'welcome' && !e.target.closest('button') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); insertCard(); }
  });

  /* ---------- PIN ---------- */
  document.querySelectorAll('input[type="password"], #tr-account, #amount, #dep-amount, #tr-amount').forEach((i) => {
    if (i.type === 'password' || i.id === 'tr-account') i.addEventListener('input', () => { i.value = i.value.replace(/\D/g, ''); });
  });
  $('f-pin').addEventListener('submit', (e) => {
    e.preventDefault();
    const i = $('pin');
    if (!isFourDigits(i.value)) return showError('pin-msg', 'PIN must be exactly four digits.', i);
    if (i.value !== account.pin) {
      i.value = '';
      if (++session.pinTries >= C.TRIES) return showScreen('blocked');
      return showError('pin-msg', `Incorrect PIN. ${C.TRIES - session.pinTries} attempt(s) remaining.`, i);
    }
    session.authenticated = true;
    showScreen('menu');
  });

  /* ---------- Menu ---------- */
  $('menu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-go]');
    if (b) showScreen(b.dataset.go);
  });

  /* ---------- Withdraw / deposit / transfer ---------- */
  $('f-withdraw').addEventListener('submit', (e) => {
    e.preventDefault();
    if (ui.screen !== 'withdraw') return;
    const r = validateWithdrawal($('amount').value);
    if (r.error) return showError('amount-msg', r.error, $('amount'));
    beginTxn({ type: 'withdraw', amount: r.amount });
  });
  document.querySelectorAll('[data-quick]').forEach((b) => b.addEventListener('click', () => {
    $('amount').value = b.dataset.quick; $('f-withdraw').requestSubmit();
  }));
  $('f-deposit').addEventListener('submit', (e) => {
    e.preventDefault();
    if (ui.screen !== 'deposit') return;
    const r = validateDeposit($('dep-amount').value);
    if (r.error) return showError('dep-msg', r.error, $('dep-amount'));
    beginTxn({ type: 'deposit', amount: r.amount });
  });
  $('f-transfer').addEventListener('submit', (e) => {
    e.preventDefault();
    if (ui.screen !== 'transfer') return;
    const r = validateTransfer($('tr-account').value, $('tr-amount').value);
    if (r.error) return showError('tr-msg', r.error, $(r.field));
    beginTxn({ type: 'transfer', amount: r.amount, acct: $('tr-account').value });
  });
  $('f-confirm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (ui.screen === 'confirm') showScreen('processing');   // leaving this screen blocks a second click
  });

  /* ---------- Receipt? / Another? ---------- */
  $('rq-yes').addEventListener('click', () => {
    if (ui.busy) return;
    ui.busy = true;
    printReceipt(ui.receipt, () => showScreen('another'));
  });
  $('rq-no').addEventListener('click', () => showScreen('another'));
  $('an-yes').addEventListener('click', () => showScreen('menu'));
  $('an-no').addEventListener('click', () => showScreen('success'));

  /* ---------- Balance / statement ---------- */
  $('balance-print').addEventListener('click', () => {
    if (ui.busy) return;
    ui.busy = true;
    printReceipt(makeReceipt(['Balance Inquiry', 'Avilable Balance:' + account.balance]), () => showScreen('success'));
  });
  $('balance-back').addEventListener('click', () => showScreen('menu'));
  $('statement-print').addEventListener('click', () => {
    if (ui.busy) return;
    ui.busy = true;
    printReceipt(makeReceipt(['Mini Statement'].concat(statementLines())), () => showScreen('success'));
  });
  $('statement-finish').addEventListener('click', () => showScreen('success'));

  /* ---------- Change PIN ---------- */
  $('f-changepin').addEventListener('submit', (e) => {
    e.preventDefault();
    if (ui.screen !== 'changepin') return;
    const r = validatePinChange($('pc-current').value, $('pc-new').value, $('pc-repeat').value);
    if (!r.ok) return showError('pc-msg', r.error, $(r.field));
    processPinChange($('pc-new').value);
    showScreen('success');
  });
  $('pc-back').addEventListener('click', () => showScreen('menu'));

  showScreen('welcome');
})();