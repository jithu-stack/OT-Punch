// OT Desk: supervisor board, site allotment, manual/WhatsApp entry, HR Excel report, setup
const TA_TYPES = [['local', 'Local site'], ['factory', 'Factory / no travel'], ['outstation', 'Outstation return'], ['night', 'Night journey'], ['custom', 'Other amount']];
const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const ROLE_ORDER = { Leader: 0, Member: 1, Helper: 2 };

const S = {
  uid: null, me: null, settings: null, teams: [], emps: [], sites: [], holidays: [], staff: [],
  date: todayIST(), tab: 'board', filter: 'all', days: new Map(), repMode: 'day', parsed: [],
};
const canReview = () => S.me && ['admin', 'supervisor'].includes(S.me.role);
const isAdmin = () => S.me && S.me.role === 'admin';
const teamName = id => (S.teams.find(t => t.id === id) || {}).name || 'NO TEAM';
const emp = code => S.emps.find(e => e.emp_code === code);
const taLabel = k => (TA_TYPES.find(x => x[0] === k) || TA_TYPES[0])[1];
const taAmt = k => (S.settings ? { local: S.settings.ta_local, factory: S.settings.ta_factory, outstation: S.settings.ta_outstation, night: S.settings.ta_night }[k] : null);
const taOptions = sel => TA_TYPES.map(([k, l]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(l)}${k !== 'custom' ? ' — ₹' + (taAmt(k) ?? 0) : ''}</option>`).join('');
const foodYes = d => d.food_status === 'auto' || d.food_status === 'approved';
const fail = error => { if (error) { toast(errText(error)); return true; } return false; };

/* ---------- login ---------- */
$('#loginForm').addEventListener('submit', async e => { e.preventDefault(); await auth('login'); });
$('#signupBtn').addEventListener('click', () => auth('signup'));
async function auth(kind) {
  const email = $('#lEmail').value.trim(), password = $('#lPass').value;
  if (!email || password.length < 6) { $('#loginMsg').textContent = 'Enter your email and a password of at least 6 characters.'; return; }
  $('#loginMsg').textContent = 'Please wait…';
  const { data, error } = kind === 'signup' ? await sb.auth.signUp({ email, password }) : await sb.auth.signInWithPassword({ email, password });
  if (error) { $('#loginMsg').textContent = errText(error); return; }
  if (!data.session) { $('#loginMsg').textContent = 'Account created. Turn off "Confirm email" in Supabase (see README), then log in.'; return; }
  $('#loginMsg').textContent = '';
  start();
}
$('#logoutBtn').addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });

async function start() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { $('#loginView').hidden = false; return; }
  S.uid = session.user.id;
  const { data: me } = await sb.from('staff').select('*').eq('user_id', S.uid).maybeSingle();
  if (!me) {
    await sb.auth.signOut();
    $('#loginView').hidden = false;
    $('#loginMsg').textContent = 'This login is not on the staff list. Technicians use punch.html.';
    return;
  }
  S.me = me;
  $('#me').textContent = `${me.name || me.email} · ${me.role}`;
  $('#loginView').hidden = true; $('#app').hidden = false; $('#logoutBtn').hidden = false; $('#dateBox').hidden = false;
  $('#workDate').value = S.date;
  $('#repMonth').value = S.date.slice(0, 7);
  await loadRef();
  setTab((location.hash || '#board').slice(1));
}

async function loadRef() {
  const [st, tm, em, si, ho, sf] = await Promise.all([
    sb.from('settings').select('*').eq('id', 1).single(),
    sb.from('teams').select('*').order('sort'),
    sb.from('employees').select('*'),
    sb.from('sites').select('*').order('name'),
    sb.from('holidays').select('*').order('day'),
    sb.from('staff').select('*').order('email'),
  ]);
  for (const r of [st, tm, em, si, ho, sf]) if (fail(r.error)) return;
  S.settings = st.data; S.teams = tm.data; S.sites = si.data; S.holidays = ho.data; S.staff = sf.data;
  const tsort = id => (S.teams.find(t => t.id === id) || { sort: 999 }).sort;
  S.emps = em.data.sort((a, b) => tsort(a.team_id) - tsort(b.team_id) || ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name));
}

/* ---------- tabs ---------- */
const PAGES = {
  all: ['Dashboard', () => `${niceDate(S.date)} · all teams`],
  attention: ['Needs attention', () => `${niceDate(S.date)} · technicians flagged today`],
  approve: ['Approve', () => `${niceDate(S.date)} · entries waiting for approval`],
  missing: ['Not reported', () => `${niceDate(S.date)} · no punches or entry yet`],
  approved: ['Approved', () => niceDate(S.date)],
  allot: ['Site allotment', () => `${niceDate(S.date)} · where each team works`],
  entry: ['Manual entry', () => 'Team entry and WhatsApp messages'],
  report: ['Reports', () => 'OT and allowance list for HR'],
  setup: ['Setup', () => 'Rules, sites, staff logins and roster'],
};
const niceDate = d => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

function setTab(t) {
  if (!$('#tab-' + t)) t = 'board';
  S.tab = t;
  $$('section[id^="tab-"]').forEach(s => (s.hidden = s.id !== 'tab-' + t));
  try { history.replaceState(null, '', '#' + t); } catch (_) {}
  markNav();
  refresh();
}
// sidebar highlight + top bar title follow the tab (and the board filter)
function markNav() {
  const key = S.tab === 'board' ? S.filter : S.tab;
  $$('#tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === S.tab && (S.tab !== 'board' || b.dataset.f === key || (b.dataset.f === 'all' && !$(`#tabs button[data-f="${key}"]`)))));
  $$('#filter button').forEach(x => x.setAttribute('aria-pressed', x.dataset.f === S.filter));
  const [title, sub] = PAGES[key] || PAGES.all;
  $('#pageTitle').textContent = title; $('#pageSub').textContent = sub();
  $('#app').classList.remove('nav-open');
}
function refresh() {
  ({ board: loadBoard, allot: loadAllot, entry: renderEntry, report: loadReport, setup: renderSetup })[S.tab]();
}
$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('button[data-tab]'); if (!b) return;
  if (b.dataset.f) S.filter = b.dataset.f;
  setTab(b.dataset.tab);
});
$('#menuBtn').addEventListener('click', () => $('#app').classList.toggle('nav-open'));
$('#workDate').addEventListener('change', e => { S.date = e.target.value || todayIST(); markNav(); refresh(); });

/* ---------- board ---------- */
function flags(d) {
  const f = [];
  if (!d.in_time || !d.out_time) f.push(['bad', 'Start or end time missing']);
  if (d.source === 'punch') {
    const km = v => (v == null ? '?' : v >= 1000 ? (v / 1000).toFixed(1) + ' km' : v + ' m');
    if (d.presence === 'VERIFIED') f.push(['ok', `At site (${km(d.in_dist)})`]);
    else if (d.presence === 'OUTSIDE SITE') f.push(['warn', `Punched away from site (in ${km(d.in_dist)} · out ${km(d.out_dist)})`]);
    else if (d.presence === 'NO PUNCH IN' || d.presence === 'NO PUNCH OUT') f.push(['bad', d.presence === 'NO PUNCH IN' ? 'No punch in' : 'No punch out']);
    else if (d.presence === 'SITE NOT SET') f.push(['info', 'Site not set — distance not checked']);
    if (!d.complete && d.in_time && d.out_time) f.push(['warn', 'OT / travel punches not finished']);
  } else f.push(['info', d.source === 'whatsapp' ? 'From WhatsApp' : 'Manual entry']);
  if (d.past_shift_no_ot) f.push(['warn', `Worked past ${hhmm(d.shift_end)} without OT punch — not paid`]);
  if (d.late_start) f.push(['warn', `Late start (shift ${hhmm(d.shift_start)})`]);
  if (d.worked_h > d.max_duty_h) f.push(['bad', `Duty over ${d.max_duty_h} h — check times`]);
  if (d.ot_actual_h > d.max_ot_h) f.push(['warn', `OT over ${d.max_ot_h} h — confirm`]);
  if (d.ot_h > 0 && !(d.opr_no || '').trim() && !(d.remark || '').trim()) f.push(['warn', 'OT without OPR no. or remark']);
  if (d.no_ot_pg && d.ot_raw_min > 0) f.push(['info', 'PG member — no OT']);
  if (d.off_day) f.push(['info', `${d.holiday ? 'Holiday' : 'Sunday'} — all hours OT ×${d.mult}`]);
  if (d.food_status === 'auto') f.push(['ok', 'Food — worked late']);
  else if (d.food_status === 'pending') f.push(['warn', 'Food needs supervisor approval']);
  else if (d.food_status === 'approved') f.push(['ok', 'Food approved']);
  if (!d.present) f.push(['need', 'Presence not confirmed']);
  if (d.status === 'query') f.push(['bad', 'Query: ' + (d.note || '')]);
  return f;
}
const chips = fl => fl.map(f => `<span class="chip ${f[0]}">${esc(f[1])}</span>`).join('');

function boardRows() {
  return S.emps.filter(e => e.active || S.days.has(e.emp_code)).map(e => {
    const d = S.days.get(e.emp_code) || null;
    const fl = d ? flags(d) : [];
    const state = !d ? 'missing' : d.status === 'approved' ? 'approved' : fl.some(f => f[0] === 'bad') || !d.present ? 'bad' : fl.some(f => f[0] === 'warn') ? 'warn' : 'clean';
    return { e, d, fl, state };
  });
}

async function loadBoard() {
  const { data, error } = await sb.from('v_day').select('*').eq('work_date', S.date);
  if (fail(error)) return;
  S.days = new Map(data.map(d => [d.emp_code, d]));
  renderBoard();
}

function renderBoard() {
  const rows = boardRows();
  const total = S.emps.filter(e => e.active).length;
  const rep = rows.filter(r => r.d).length, appr = rows.filter(r => r.state === 'approved').length;
  const att = rows.filter(r => r.state === 'bad' || r.state === 'warn').length;
  const ot = rows.reduce((s, r) => s + (r.d ? +r.d.ot_h : 0), 0);
  const ta = rows.reduce((s, r) => s + (r.d ? +r.d.ta_amount : 0), 0);
  const food = rows.filter(r => r.d && foodYes(r.d)).length;
  const pend = rows.filter(r => r.d && r.state !== 'approved').length;
  const tile = (k, icon, v, small) => `<div class="tile"><div class="k">${k}<i class="icon-${icon}"></i></div><div class="v">${v}${small ? `<small>${small}</small>` : ''}</div></div>`;
  $('#tiles').innerHTML = tile('Punched in', 'log-in', rep, `of ${total}`)
    + tile('Not reported', 'user-x', total - rep)
    + tile('Needs attention', 'triangle-alert', att)
    + tile('Approved', 'check-check', appr, `of ${rep}`)
    + tile('Total OT', 'timer', fmtH(ot), `h · TA ₹ ${ta.toLocaleString('en-IN')}${food ? ` · food ${food}` : ''}`);
  $('#navAttn').textContent = att || '';
  $('#navPend').textContent = pend || '';
  $('#pageSub').textContent = (PAGES[S.filter] || PAGES.all)[1]();
  $('#tab-board').classList.toggle('attn-mode', S.filter === 'attention');
  if (S.filter === 'attention') { $('#boardTable').hidden = true; $('#attnList').hidden = false; renderAttention(rows.filter(r => r.state === 'bad' || r.state === 'warn')); return; }
  $('#boardTable').hidden = false; $('#attnList').hidden = true;
  const keep = r => S.filter === 'all' || (S.filter === 'missing' && r.state === 'missing') || (S.filter === 'approved' && r.state === 'approved')
    || (S.filter === 'approve' && r.d && r.state !== 'approved');
  const cls = { missing: 'state-missing', bad: 'state-bad', warn: 'state-warn', approved: 'state-ok', clean: '' };
  const byTeam = new Map();
  rows.forEach(r => { const k = teamName(r.e.team_id); byTeam.set(k, [...(byTeam.get(k) || []), r]); });
  let html = '';
  for (const [team, list] of byTeam) {
    const shown = list.filter(keep);
    if (!shown.length) continue;
    const tot = list.reduce((s, r) => s + (r.d ? +r.d.ot_h : 0), 0);
    html += `<tr class="teamrow"><td colspan="9">${esc(team)}<span class="sub">${list.filter(r => r.d).length}/${list.length} reported · ${fmtH(tot)} h OT</span></td></tr>`;
    html += shown.map(r => rowHTML(r, cls[r.state])).join('');
  }
  $('#boardBody').innerHTML = html || '<tr><td colspan="9" class="empty">Nothing in this view.</td></tr>';
}

function rowHTML({ e, d, fl, state }, cls) {
  const tag = `${e.is_pg ? ' <span class="chip info">PG</span>' : ''}${e.role !== 'Member' ? ` <span class="chip">${esc(e.role)}</span>` : ''}`;
  if (!d) {
    return `<tr class="${cls}"><td><b>${esc(e.name)}</b>${tag}<span class="sub">${esc(e.emp_code)}</span></td><td>—</td><td></td><td class="num">–</td><td class="num">–</td><td><span class="chip">Not reported</span></td><td></td><td></td>
      <td>${canReview() ? `<button class="btn sm" data-act="add" data-emp="${esc(e.emp_code)}">Add entry</button>` : ''}</td></tr>`;
  }
  const ro = !canReview();
  const photos = [d.photo_in && `<button class="btn sm" data-act="photo" data-path="${esc(d.photo_in)}">In photo</button>`, d.photo_out && `<button class="btn sm" data-act="photo" data-path="${esc(d.photo_out)}">Out photo</button>`].filter(Boolean).join('');
  const food = d.food_status === 'auto' ? '<span class="chip ok">Yes</span>'
    : (d.food_status === 'none' || d.food_status === 'noteligible') && (d.team_pg || d.is_pg) ? '<span class="muted" style="font-size:12px">Not eligible</span>'
    : `<label class="check" style="font-size:12px"><input type="checkbox" data-act="food" ${d.food_approved ? 'checked' : ''} ${ro ? 'disabled' : ''}>${d.food_claim ? 'Claimed' : 'Approve'}</label>`;
  const acts = ro ? '' : state === 'approved'
    ? '<button class="btn sm" data-act="reopen">Reopen</button>'
    : `<button class="btn sm ok" data-act="approve" ${state === 'bad' ? 'disabled title="Fix red checks and confirm presence first"' : ''}>Approve</button><button class="btn sm" data-act="query">Query</button>`;
  return `<tr class="${cls}" data-emp="${esc(e.emp_code)}">
    <td><b>${esc(e.name)}</b>${tag}<span class="sub">${esc(e.emp_code)}</span>${state === 'approved' ? '<span class="chip ok">Approved</span>' : ''}</td>
    <td class="mono">${esc(fmt12(d.in_time) || '?')} – ${esc(fmt12(d.out_time) || '?')}<span class="sub">${d.shift === 'S2' ? 'Shift 2' : 'Shift 1'}${d.ot_start ? ' · OT ' + esc(fmt12(d.ot_start)) + '–' + esc(fmt12(d.ot_end) || '?') : ''}${d.travel_time ? ' · travel ' + esc(d.travel_time) : ''}</span></td>
    <td>${esc(d.location || '—')}<span class="sub mono">${esc(d.opr_no || '')}</span>${d.remark ? `<span class="sub">${esc(d.remark)}</span>` : ''}</td>
    <td class="num"><b>${fmtH(d.ot_h)}</b>${d.mult > 1 ? `<span class="sub">${fmtH(d.ot_actual_h)} × ${d.mult}</span>` : ''}</td>
    <td class="num">${d.ta_amount}<span class="sub">${esc(taLabel(d.ta_type))}</span></td>
    <td><div class="chips">${chips(fl.filter(f => f[0] !== 'need'))}</div></td>
    <td><input type="checkbox" data-act="present" ${d.present ? 'checked' : ''} ${ro ? 'disabled' : ''} aria-label="Presence confirmed"></td>
    <td>${food}</td>
    <td><div class="acts">${acts}${ro ? '' : '<button class="btn sm" data-act="edit">Edit</button>'}${photos}</div></td></tr>`;
}

async function review(code, date, changes) {
  const { error } = await sb.from('day_reviews').upsert({ emp_code: code, work_date: date, ...changes, updated_at: new Date().toISOString() }, { onConflict: 'emp_code,work_date' });
  return !fail(error);
}

// "Needs attention": one card per flagged technician with selfie, location stamp and map link
async function renderAttention(list) {
  const box = $('#attnList');
  if (!list.length) { box.innerHTML = '<div class="card empty">Nothing needs attention today.</div>'; return; }
  const { data: punches } = await sb.from('punches').select('emp_code, kind, at, lat, lng, dist_m, photo_path').eq('work_date', S.date).order('at');
  const byEmp = new Map();
  (punches || []).forEach(p => byEmp.set(p.emp_code, [...(byEmp.get(p.emp_code) || []), p]));
  const pick = r => {
    const ps = (byEmp.get(r.e.emp_code) || []).filter(p => p.lat != null);
    const radius = r.d && r.d.radius;
    return ps.find(p => radius && p.dist_m > radius) || ps.find(p => p.kind === 'work_in') || ps[0] || null;
  };
  const shots = list.map(pick);
  const paths = shots.filter(p => p && p.photo_path).map(p => p.photo_path);
  const urls = new Map();
  if (paths.length) {
    const { data } = await sb.storage.from('punch-photos').createSignedUrls(paths, 600);
    (data || []).forEach(u => u.signedUrl && urls.set(u.path, u.signedUrl));
  }
  const day = new Date(S.date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  box.innerHTML = list.map((r, i) => {
    const { e, d, fl } = r, p = shots[i];
    const url = p && urls.get(p.photo_path);
    const stamp = p ? `${fmtTs(p.at)} · ${day}\n${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}` : 'No photo';
    const ph = url ? `<button class="ph" data-act="photo" data-path="${esc(p.photo_path)}"><img src="${esc(url)}" alt="Selfie of ${esc(e.name)}"><span class="stamp">${esc(stamp)}</span></button>`
      : `<div class="ph"><i class="${p ? 'icon-user-round' : 'icon-camera-off'}"></i><span class="stamp">${esc(stamp)}</span></div>`;
    const issues = fl.filter(f => f[0] === 'bad' || f[0] === 'warn' || f[0] === 'need');
    const map = p ? `<a class="btn" href="https://maps.google.com/?q=${p.lat},${p.lng}" target="_blank" rel="noopener"><i class="icon-map-pin"></i>Open map</a>` : '';
    return `<div class="attn-card" data-emp="${esc(e.emp_code)}">${ph}
      <div style="min-width:0"><div class="who">${esc(e.name)}</div>
        <div class="meta"><span class="mono">${esc(e.emp_code)}</span> · ${esc(d.location || teamName(e.team_id))}${d.opr_no ? ` · <span class="mono">${esc(d.opr_no)}</span>` : ''}</div>
        ${issues.map(f => `<div class="flag"><span class="chip ${f[0]}">${esc(flagType(f[1]))}</span><span>${esc(f[1])}</span></div>`).join('')}</div>
      <div class="side">${map}${canReview() ? '<button class="btn" data-act="edit"><i class="icon-pencil"></i>Edit</button>' : ''}</div></div>`;
  }).join('');
}
const flagType = t => /late/i.test(t) ? 'Late start' : /away from site|outside/i.test(t) ? 'Outside site' : /missing|no punch/i.test(t) ? 'Missing punch'
  : /OT over|Duty over/i.test(t) ? 'Over limit' : /not finished/i.test(t) ? 'Pending punch' : /Presence/i.test(t) ? 'Presence' : /Food/i.test(t) ? 'Food' : /Query/i.test(t) ? 'Query' : 'Check';

$('#attnList').addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  if (b.dataset.act === 'photo') {
    const { data, error } = await sb.storage.from('punch-photos').createSignedUrl(b.dataset.path, 300);
    if (!fail(error)) window.open(data.signedUrl, '_blank', 'noopener');
  } else if (b.dataset.act === 'edit') {
    const code = b.closest('.attn-card').dataset.emp;
    openEdit(code, S.days.get(code));
  }
});

$('#filter').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  S.filter = b.dataset.f; markNav(); renderBoard();
});

$('#boardBody').addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act;
  if (act === 'add') { const em = emp(b.dataset.emp); setTab('entry'); fillEntry(em.team_id, [em.emp_code]); return; }
  if (act === 'photo') {
    const { data, error } = await sb.storage.from('punch-photos').createSignedUrl(b.dataset.path, 300);
    if (!fail(error)) window.open(data.signedUrl, '_blank', 'noopener');
    return;
  }
  const code = b.closest('tr').dataset.emp, d = S.days.get(code);
  let ok = true;
  if (act === 'present') ok = await review(code, S.date, { present: b.checked, ...(d.status === 'approved' && !b.checked ? { status: 'submitted' } : {}) });
  else if (act === 'food') ok = await review(code, S.date, { food_approved: b.checked });
  else if (act === 'approve') ok = await review(code, S.date, { status: 'approved', approved_by: S.uid, approved_at: new Date().toISOString() });
  else if (act === 'reopen') ok = await review(code, S.date, { status: 'submitted' });
  else if (act === 'query') return openQuery(code, d);
  else if (act === 'edit') return openEdit(code, d);
  if (ok) loadBoard();
});

function openSheet(title, body, buttons) {
  $('#overlay').innerHTML = `<div class="overlay"><div class="sheet" role="dialog" aria-label="${esc(title)}"><h2>${esc(title)}</h2>${body}
    <div class="toolbar" style="margin:6px 0 0">${buttons.map((b, i) => `<button class="btn ${b[1]}" data-i="${i}">${esc(b[0])}</button>`).join('')}<span class="grow"></span><button class="btn" data-close>Close</button></div></div></div>`;
  $('#overlay').onclick = async ev => {
    if (ev.target.matches('[data-close]') || ev.target.classList.contains('overlay')) return closeSheet();
    const btn = ev.target.closest('[data-i]'); if (btn) await buttons[+btn.dataset.i][2]();
  };
}
const closeSheet = () => { $('#overlay').innerHTML = ''; };

function openQuery(code, d) {
  const e = emp(code);
  openSheet(`Query ${e.name}`, `<div class="field"><label for="qNote">What needs clarifying?</label><input id="qNote" value="${esc(d.note || 'Please confirm your work end time')}"></div>`,
    [['Save & copy WhatsApp message', 'primary', async () => {
      const note = $('#qNote').value.trim();
      if (await review(code, S.date, { status: 'query', note })) {
        copyText(`Hi ${e.name}, about ${S.date} (${fmt12(d.in_time)}–${fmt12(d.out_time)}, ${d.location || ''}): ${note}`);
        closeSheet(); loadBoard();
      }
    }]]);
}

function openEdit(code, d) {
  const e = emp(code);
  const f = { in_time: hhmm(d.in_time), out_time: hhmm(d.out_time), ot_start: hhmm(d.ot_start), ot_end: hhmm(d.ot_end), travel_time: d.travel_time || '', location: d.location || '', opr_no: d.opr_no || '', remark: d.remark || '', shift: d.shift, ta_type: d.ta_type, ta_amount: d.ta_type === 'custom' ? d.ta_amount : '' };
  const inp = (k, label, type = 'text') => `<div class="field"><label for="e_${k}">${label}</label><input id="e_${k}" type="${type}" value="${esc(f[k])}"></div>`;
  openSheet(`Edit ${e.name} — ${S.date}`, `<p class="muted" style="margin:0">Changed fields override the punches for this day.</p><div class="form">
    ${inp('in_time', 'Work start', 'time')}${inp('out_time', 'Work end', 'time')}${inp('ot_start', 'OT start', 'time')}${inp('ot_end', 'OT end', 'time')}
    ${inp('travel_time', 'Traveling time')}${inp('location', 'Location')}
    <div class="field"><label for="e_shift">Shift</label><select id="e_shift"><option value="S1" ${f.shift === 'S1' ? 'selected' : ''}>Shift 1</option><option value="S2" ${f.shift === 'S2' ? 'selected' : ''}>Shift 2</option></select></div>
    <div class="field"><label for="e_ta_type">Travelling allowance</label><select id="e_ta_type">${taOptions(f.ta_type)}</select></div>
    ${inp('ta_amount', 'Amount ₹ (other)', 'number')}${inp('opr_no', 'OPR no.')}
    <div class="field full"><label for="e_remark">Remark</label><input id="e_remark" value="${esc(f.remark)}"></div></div>`,
    [['Save', 'primary', async () => {
      const ch = {};
      for (const k of Object.keys(f)) {
        const v = $('#e_' + k).value.trim();
        if (String(v) !== String(f[k] ?? '')) ch[k] = v === '' ? null : k === 'ta_amount' ? +v : v;
      }
      if (!Object.keys(ch).length) return closeSheet();
      if (await review(code, S.date, { ...ch, status: d.status === 'approved' ? 'submitted' : d.status })) { closeSheet(); loadBoard(); toast('Saved'); }
    }],
    ...(d.n_punches ? [['Delete last punch', '', async () => {
      if (!confirm(`Delete ${e.name}'s last punch for ${S.date}? They will punch it again.`)) return;
      const { data } = await sb.from('punches').select('id,kind').eq('emp_code', code).eq('work_date', S.date).order('at', { ascending: false }).limit(1);
      if (!data || !data.length) return;
      const { error } = await sb.from('punches').delete().eq('id', data[0].id);
      if (!fail(error)) { toast(`Deleted ${data[0].kind}`); closeSheet(); loadBoard(); }
    }]] : [])]);
}

$('#copyReminder').addEventListener('click', () => {
  const miss = boardRows().filter(r => r.state === 'missing');
  if (!miss.length) return toast('Everyone has reported');
  const byT = new Map();
  miss.forEach(r => { const k = teamName(r.e.team_id); byT.set(k, [...(byT.get(k) || []), r.e.name]); });
  copyText(`Punch reminder for ${S.date} — not yet received:\n${[...byT].map(([k, v]) => `• ${k}: ${v.join(', ')}`).join('\n')}\n\nPlease open Stemhub Punch and complete today's punches.`);
});

$('#approveClean').addEventListener('click', async () => {
  if (!canReview()) return;
  const rs = boardRows().filter(r => r.state === 'clean');
  if (!rs.length) return toast('No clean entries waiting — check the flagged ones');
  const now = new Date().toISOString();
  const { error } = await sb.from('day_reviews').upsert(rs.map(r => ({ emp_code: r.e.emp_code, work_date: S.date, status: 'approved', approved_by: S.uid, approved_at: now, updated_at: now })), { onConflict: 'emp_code,work_date' });
  if (!fail(error)) { toast(`${rs.length} approved`); loadBoard(); }
});

/* ---------- site allotment ---------- */
async function loadAllot(fromDate) {
  const { data, error } = await sb.from('allotments').select('*').eq('work_date', fromDate || S.date);
  if (fail(error)) return;
  const by = new Map(data.map(a => [a.team_id, a]));
  const siteOpts = sel => '<option value="">— not set —</option>' + S.sites.map(s => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  $('#allotBody').innerHTML = S.teams.map(t => {
    const a = by.get(t.id) || {};
    return `<tr data-team="${t.id}"><td><b>${esc(t.name)}</b></td>
      <td><select data-k="site_id">${siteOpts(a.site_id)}</select></td>
      <td><select data-k="shift"><option value="S1">Shift 1</option><option value="S2" ${a.shift === 'S2' ? 'selected' : ''}>Shift 2</option></select></td>
      <td><input data-k="opr_no" value="${esc(a.opr_no || '')}"></td>
      <td><select data-k="ta_type">${taOptions(a.ta_type || 'local')}</select></td>
      <td><input data-k="ta_amount" type="number" min="0" step="50" value="${a.ta_amount ?? ''}"></td></tr>`;
  }).join('');
  if (fromDate) toast(data.length ? `Copied ${fromDate} — press Save` : `Nothing allotted on ${fromDate}`);
}
$('#copyPrevAllot').addEventListener('click', () => {
  const d = new Date(S.date + 'T00:00'); d.setDate(d.getDate() - 1); loadAllot(ymd(d));
});
$('#saveAllot').addEventListener('click', async () => {
  const rows = $$('#allotBody tr').map(tr => {
    const v = k => tr.querySelector(`[data-k="${k}"]`).value.trim();
    return { work_date: S.date, team_id: +tr.dataset.team, site_id: v('site_id') ? +v('site_id') : null, shift: v('shift'), opr_no: v('opr_no') || null, ta_type: v('ta_type'), ta_amount: v('ta_amount') === '' ? null : +v('ta_amount') };
  });
  const { error } = await sb.from('allotments').upsert(rows, { onConflict: 'work_date,team_id' });
  if (!fail(error)) toast('Allotment saved');
});

/* ---------- manual entry ---------- */
function renderEntry() {
  if (!$('#fTeam').options.length) {
    $('#fTeam').innerHTML = S.teams.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
    $('#fTa').innerHTML = taOptions('local');
    fillEntry(S.teams[0] && S.teams[0].id);
  }
  $('#fDate').value = S.date;
}
function fillEntry(teamId, only) {
  renderEntry();
  $('#fTeam').value = teamId;
  $('#fMembers').innerHTML = S.emps.filter(e => e.team_id === +teamId && e.active)
    .map(e => `<label><input type="checkbox" value="${esc(e.emp_code)}" ${!only || only.includes(e.emp_code) ? 'checked' : ''}> ${esc(e.name)} <span class="muted mono">${esc(e.emp_code)}</span></label>`).join('') || '<span class="muted">No members.</span>';
}
$('#fTeam').addEventListener('change', () => fillEntry($('#fTeam').value));
$('#entryForm').addEventListener('submit', async e => {
  e.preventDefault();
  const codes = $$('#fMembers input:checked').map(i => i.value);
  const date = $('#fDate').value, inT = $('#fIn').value, outT = $('#fOut').value;
  if (!codes.length || !date || !inT || !outT) return toast('Tick members and fill date, start and end');
  const ta = $('#fTa').value;
  const base = {
    work_date: date, source: 'form', status: 'submitted', in_time: inT, out_time: outT, ot_start: null, ot_end: null,
    travel_time: $('#fTravel').value.trim() || null, break_min: +$('#fBreak').value || 0, shift: $('#fShift').value || null,
    location: $('#fLoc').value.trim() || null, opr_no: $('#fOpr').value.trim() || null, ta_type: ta,
    ta_amount: ta === 'custom' ? +$('#fTaAmt').value || 0 : null, remark: $('#fRemark').value.trim() || null,
    food_claim: $('#fFood').checked, present: $('#fPresent').checked ? true : null, updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from('day_reviews').upsert(codes.map(c => ({ ...base, emp_code: c })), { onConflict: 'emp_code,work_date' });
  if (fail(error)) return;
  toast(`${codes.length} entries saved`);
  S.date = date; $('#workDate').value = date; setTab('board');
});

/* WhatsApp: "OT | TEAM 3 | DM140, HR703 | S2 | 08:30 | 20:00 | Travel: 21:00 | Loc: .. | OPR: .. | TA: Local | Food" */
const PREFIX = /^\[?(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4}),?\s+(\d{1,2})[:.](\d{2})(?::\d{2})?\s*([ap]\.?\s?m\.?)?\]?\s*[-–]?\s*[^:]{1,60}:\s?(.*)$/i;
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function parseTime(s) {
  const m = /^(\d{1,2})[:.](\d{2})\s*([ap])?\.?m?\.?$/i.exec(s.trim());
  if (!m) return null;
  let h = +m[1];
  if (m[3]) { if (/p/i.test(m[3]) && h < 12) h += 12; if (/a/i.test(m[3]) && h === 12) h = 0; }
  return h < 24 && +m[2] < 60 ? `${pad(h)}:${m[2]}` : null;
}
function parseWhatsApp(text) {
  const out = []; let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes('|')) continue;
    let body = line, date = S.date;
    const m = PREFIX.exec(line);
    if (m) {
      let y = +m[3]; if (y < 100) y += 2000;
      let h = +m[4]; if (m[6] && /p/i.test(m[6]) && h < 12) h += 12; if (m[6] && /a/i.test(m[6]) && h === 12) h = 0;
      const d = new Date(`${y}-${pad(+m[2])}-${pad(+m[1])}T00:00`);
      if (h < 6) d.setDate(d.getDate() - 1); // sent after midnight → previous working day
      date = ymd(d); body = m[7];
    }
    const r = { date, codes: [], team: null, shift: null, times: [], travel: '', loc: '', opr: '', ta: 'local', taAmt: null, remark: '', food: false, issues: [] };
    for (const seg of body.split('|').map(s => s.trim()).filter(Boolean)) {
      let k;
      if ((k = /^travel\w*\s*(?:time)?\s*[:=-]\s*(.*)$/i.exec(seg))) r.travel = k[1];
      else if ((k = /^(?:loc|location|site)\s*[:=-]\s*(.*)$/i.exec(seg))) r.loc = k[1];
      else if ((k = /^(?:opr|job)\s*(?:no\.?)?\s*[:=-]\s*(.*)$/i.exec(seg))) r.opr = k[1];
      else if ((k = /^remarks?\s*[:=-]\s*(.*)$/i.exec(seg))) r.remark = k[1] === '-' ? '' : k[1];
      else if ((k = /^date\s*[:=-]\s*(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?$/i.exec(seg))) { let y = k[3] ? +k[3] : +S.date.slice(0, 4); if (y < 100) y += 2000; r.date = `${y}-${pad(+k[2])}-${pad(+k[1])}`; }
      else if ((k = /^ta\s*[:=-]\s*(.*)$/i.exec(seg))) {
        const v = k[1].toLowerCase();
        if (/^\d+$/.test(v)) { r.ta = 'custom'; r.taAmt = +v; }
        else r.ta = /night/.test(v) ? 'night' : /out/.test(v) ? 'outstation' : /fact|no/.test(v) ? 'factory' : 'local';
      }
      else if (/^food$/i.test(seg)) r.food = true;
      else if (/^s[12]$/i.test(seg)) r.shift = seg.toUpperCase();
      else if (parseTime(seg)) r.times.push(parseTime(seg));
      else if (/^ot$/i.test(seg)) continue;
      else {
        const t = S.teams.find(t => norm(t.name) === norm(seg) || (norm(seg).length > 2 && norm(t.name).endsWith(norm(seg))));
        if (t) { r.team = t; continue; }
        for (const tok of seg.split(/[\s,;]+/).filter(Boolean)) {
          const e = S.emps.find(e => norm(e.emp_code) === norm(tok));
          if (e) r.codes.push(e.emp_code); else r.issues.push(`Unknown: ${tok}`);
        }
      }
    }
    if (!r.codes.length && r.team) r.codes = S.emps.filter(e => e.team_id === r.team.id && e.active).map(e => e.emp_code);
    if (r.times.length < 2 || !r.codes.length) { skipped++; continue; }
    out.push(r);
  }
  return { out, skipped };
}
$('#copyTpl').addEventListener('click', () => copyText($('#tplText').textContent));
$('#parseBtn').addEventListener('click', () => {
  const { out, skipped } = parseWhatsApp($('#pasteBox').value);
  S.parsed = out;
  $('#parseInfo').textContent = `${out.length} message(s) read${skipped ? `, ${skipped} skipped (no times or no people)` : ''}`;
  $('#saveParsed').disabled = !out.length || !canReview();
  $('#parsedWrap').innerHTML = out.length ? `<div class="tablebox"><table><thead><tr><th>Date</th><th>People</th><th>Times</th><th>Loc · TA</th><th>Issues</th></tr></thead><tbody>${out.map(r => `<tr>
    <td class="mono">${esc(r.date)}</td><td>${esc(r.codes.map(c => emp(c).name).join(', '))}</td><td class="mono">${esc(r.times[0])}–${esc(r.times[1])}${r.shift ? ' ' + r.shift : ''}</td>
    <td>${esc(r.loc)}<span class="sub">${esc(taLabel(r.ta))}${r.food ? ' · food' : ''}</span></td><td>${chips(r.issues.map(i => ['warn', i]))}</td></tr>`).join('')}</tbody></table></div>` : '';
});
$('#saveParsed').addEventListener('click', async () => {
  const now = new Date().toISOString();
  const rows = S.parsed.flatMap(r => r.codes.map(c => ({
    emp_code: c, work_date: r.date, source: 'whatsapp', status: 'submitted', in_time: r.times[0], out_time: r.times[1], ot_start: null, ot_end: null,
    shift: r.shift, travel_time: r.travel || null, location: r.loc || null, opr_no: r.opr || null, ta_type: r.ta, ta_amount: r.taAmt,
    remark: r.remark || null, food_claim: r.food, updated_at: now,
  })));
  const { error } = await sb.from('day_reviews').upsert(rows, { onConflict: 'emp_code,work_date' });
  if (fail(error)) return;
  toast(`${rows.length} entries saved`);
  S.parsed = []; $('#parsedWrap').innerHTML = ''; $('#saveParsed').disabled = true; $('#pasteBox').value = '';
});

/* ---------- HR report ---------- */
$('#repMode').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  S.repMode = b.dataset.m; $$('#repMode button').forEach(x => x.setAttribute('aria-pressed', x === b));
  $('#repMonth').hidden = S.repMode !== 'month'; loadReport();
});
$('#repMonth').addEventListener('change', loadReport);

function monthRange() {
  const [y, m] = $('#repMonth').value.split('-').map(Number);
  return [`${y}-${pad(m)}-01`, ymd(new Date(y, m, 0)), y, m];
}
const dmy = d => d.split('-').reverse().join('-');
const endTime = d => fmt12(d.ot_end || d.out_time);
const foodRs = d => (S.settings.food_amount > 0 && foodYes(d) ? S.settings.food_amount : 0);

async function loadReport() {
  let q = sb.from('v_day').select('*').order('work_date');
  if (S.repMode === 'day') q = q.eq('work_date', S.date);
  else { const [a, b] = monthRange(); q = q.gte('work_date', a).lte('work_date', b); }
  const { data, error } = await q;
  if (fail(error)) return;
  const appr = data.filter(d => d.status === 'approved');
  const open = data.length - appr.length;
  S.report = appr;
  $('#repNote').innerHTML = open ? `<div class="banner">${open} entr${open === 1 ? 'y is' : 'ies are'} not approved yet and left out of this report.</div>` : '';
  const food = S.settings.food_amount > 0;
  if (S.repMode === 'day') {
    $('#repTable').innerHTML = appr.length ? `<table class="wide"><thead><tr><th>SL</th><th>EMP code</th><th>Name</th><th>Team</th><th>OPR no.</th><th>Work start</th><th>Work end</th><th>Traveling time</th><th>Location</th><th class="num">OT</th><th class="num">TA ₹</th>${food ? '<th class="num">Food ₹</th>' : ''}<th>Remark</th></tr></thead><tbody>${appr.map((d, i) => `<tr>
      <td>${i + 1}</td><td class="mono">${esc(d.emp_code)}</td><td>${esc(d.name)}</td><td>${esc(d.team)}</td><td class="mono">${esc(d.opr_no || '')}</td><td class="mono">${esc(fmt12(d.in_time))}</td><td class="mono">${esc(endTime(d))}</td>
      <td>${esc(d.travel_time || '')}</td><td>${esc(d.location || '')}</td><td class="num">${fmtH(d.ot_h)}</td><td class="num">${d.ta_amount}</td>${food ? `<td class="num">${foodRs(d)}</td>` : ''}<td>${esc(d.remark || '')}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">No approved entries for this date.</div>';
  } else {
    const main = mainSheet(appr);
    $('#repTable').innerHTML = main.length ? `<table><thead><tr><th>SL</th><th>EMP code</th><th>Worker name</th><th class="num">OT h</th><th class="num">TA ₹</th>${food ? '<th class="num">Food ₹</th>' : ''}</tr></thead><tbody>${main.map(r => `<tr>
      <td>${r[0]}</td><td class="mono">${esc(r[1])}</td><td>${esc(r[2])}</td><td class="num">${fmtH(r[3])}</td><td class="num">${r[4]}</td>${food ? `<td class="num">${r[5]}</td>` : ''}</tr>`).join('')}</tbody></table>`
      : '<div class="empty">No approved entries in this month.</div>';
  }
}

function mainSheet(rows) {
  const by = new Map();
  for (const d of rows) {
    const r = by.get(d.emp_code) || { ot: 0, ta: 0, food: 0 };
    r.ot += +d.ot_h; r.ta += +d.ta_amount; r.food += foodRs(d); by.set(d.emp_code, r);
  }
  return S.emps.filter(e => by.has(e.emp_code)).map((e, i) => { const r = by.get(e.emp_code); return [i + 1, e.emp_code, e.name.toUpperCase(), r.ot, r.ta, r.food]; });
}

$('#xlsxRep').addEventListener('click', () => {
  const rows = S.report || [];
  if (!rows.length) return toast('Nothing approved to export');
  const food = S.settings.food_amount > 0;
  const wb = XLSX.utils.book_new();
  if (S.repMode === 'day') {
    const head = ['SL NO', 'EMP CODE', 'WORKER NAME', 'TEAM', 'DATE', 'OPR NO', 'WORK START TIME', 'WORK END TIME', 'TRAVELING TIME', 'LOCATION', 'OT', 'TRAVELLING ALLOWANCE', ...(food ? ['FOOD ALLOWANCE'] : []), 'REMARK'];
    const body = rows.map((d, i) => [i + 1, d.emp_code, d.name.toUpperCase(), d.team, dmy(d.work_date), d.opr_no || '', fmt12(d.in_time), endTime(d), d.travel_time || '', d.location || '', +d.ot_h, d.ta_amount, ...(food ? [foodRs(d)] : []), d.remark || '']);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, ...body]), 'DAILY OT');
    XLSX.writeFile(wb, `DAILY OT REPORT ${dmy(S.date)}.xlsx`);
    return;
  }
  const [, , y, m] = monthRange();
  const main = mainSheet(rows).map(r => (food ? r : r.slice(0, 5)));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['SL NO', 'EMP CODE', 'WORKER NAME', 'OT in Hrs', 'TRAVELLING ALLOWANCE In Rs', ...(food ? ['FOOD ALLOWANCE In Rs'] : [])], ...main]), 'MAIN SHEET');
  // one sheet per team, named after the team leader; members with the same day details share a row
  const used = new Set(['MAIN SHEET']);
  for (const t of S.teams) {
    const tr = rows.filter(d => d.team_id === t.id);
    if (!tr.length) continue;
    const leader = S.emps.find(e => e.team_id === t.id && e.role === 'Leader');
    let name = (leader ? leader.name : t.name).toUpperCase().replace(/[\[\]:*?\/\\]/g, ' ').slice(0, 31);
    while (used.has(name)) name = name.slice(0, 28) + ' ' + used.size;
    used.add(name);
    const groups = new Map();
    for (const d of tr) {
      const row = [dmy(d.work_date), '', d.opr_no || '', fmt12(d.in_time), endTime(d), d.travel_time || '', d.location || '', +d.ot_h, d.ta_amount, ...(food ? [foodRs(d)] : []), d.remark || ''];
      const key = JSON.stringify(row);
      const g = groups.get(key) || { row, names: [] };
      g.names.push(d.name.toUpperCase()); groups.set(key, g);
    }
    const body = [...groups.values()].map(g => { g.row[1] = g.names.join(', '); return g.row; });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['DATE', 'NAMES', 'OPR NO', 'WORK START TIME', 'WORK END TIME', 'TRAVELING TIME', 'LOCATION', 'OT', 'TRAVELLING ALLOWANCE', ...(food ? ['FOOD ALLOWANCE'] : []), 'REMARK'], ...body]), name);
  }
  XLSX.writeFile(wb, `ALLOWANCE AND OT LIST ${MONTHS[m - 1]} ${y}.xlsx`);
});

$('#copyRep').addEventListener('click', () => {
  const rows = S.report || [];
  if (!rows.length) return toast('Nothing approved to copy');
  if (S.repMode === 'day') {
    const tot = rows.reduce((s, d) => s + +d.ot_h, 0);
    copyText(`Daily OT report — ${dmy(S.date)}\n${rows.map((d, i) => `${i + 1}. ${d.name} (${d.emp_code}) — OT ${fmtH(d.ot_h)} h, TA ₹${d.ta_amount}${d.location ? ', ' + d.location : ''}`).join('\n')}\nTotal OT: ${fmtH(tot)} h`);
  } else {
    copyText(mainSheet(rows).map(r => `${r[0]}. ${r[2]} (${r[1]}) — OT ${fmtH(r[3])} h, TA ₹${r[4]}`).join('\n'));
  }
});

/* ---------- setup ---------- */
function renderSetup() {
  $('#setupNote').textContent = isAdmin() ? '' : 'Only the admin can change these settings.';
  const f = $('#rulesForm');
  for (const el of f.elements) {
    if (!el.name) continue;
    const v = S.settings[el.name];
    if (el.type === 'checkbox') el.checked = !!v;
    else if (el.type === 'time') el.value = hhmm(v);
    else el.value = String(v);
  }
  $('#holBox').value = S.holidays.map(h => `${h.day}, ${h.name || ''}`).join('\n');
  renderSites(); renderStaff(); renderRoster();
}

$('#rulesForm').addEventListener('submit', async e => {
  e.preventDefault();
  const ch = {};
  for (const el of e.target.elements) {
    if (!el.name) continue;
    ch[el.name] = el.type === 'checkbox' ? el.checked : el.type === 'time' ? el.value : el.type === 'number' || el.name === 'round_h' ? +el.value : el.value;
  }
  const { error } = await sb.from('settings').update(ch).eq('id', 1);
  if (fail(error)) return;
  const hol = $('#holBox').value.split(/\r?\n/).map(l => l.split(',')).filter(p => /^\d{4}-\d{2}-\d{2}$/.test(p[0].trim()))
    .map(p => ({ day: p[0].trim(), name: p.slice(1).join(',').trim() || null }));
  const del = await sb.from('holidays').delete().gte('day', '1900-01-01');
  if (fail(del.error)) return;
  if (hol.length && fail((await sb.from('holidays').insert(hol)).error)) return;
  await loadRef(); renderSetup(); toast('Rules saved');
});

function renderSites() {
  $('#sitesBody').innerHTML = S.sites.map(s => siteRow(s)).join('') || '<tr><td colspan="5" class="muted">No sites yet.</td></tr>';
}
const siteRow = s => `<tr data-id="${s.id || ''}"><td><input data-k="name" value="${esc(s.name || '')}"></td><td><input data-k="lat" value="${s.lat ?? ''}"></td><td><input data-k="lng" value="${s.lng ?? ''}"></td><td><input data-k="radius_m" type="number" value="${s.radius_m ?? ''}" placeholder="${S.settings.site_radius_m}"></td><td><button class="btn sm" type="button" data-act="here">Use my location</button></td></tr>`;
$('#addSite').addEventListener('click', () => {
  if (!S.sites.length) $('#sitesBody').innerHTML = '';
  $('#sitesBody').insertAdjacentHTML('beforeend', siteRow({}));
});
$('#sitesBody').addEventListener('click', e => {
  const b = e.target.closest('[data-act="here"]'); if (!b) return;
  const tr = b.closest('tr');
  b.textContent = 'Locating…';
  navigator.geolocation.getCurrentPosition(p => {
    tr.querySelector('[data-k="lat"]').value = p.coords.latitude.toFixed(6);
    tr.querySelector('[data-k="lng"]').value = p.coords.longitude.toFixed(6);
    b.textContent = `±${Math.round(p.coords.accuracy)} m`;
  }, () => { b.textContent = 'Use my location'; toast('Could not get location'); }, { enableHighAccuracy: true, timeout: 20000 });
});
$('#saveSites').addEventListener('click', async () => {
  const rows = $$('#sitesBody tr[data-id]').map(tr => {
    const v = k => tr.querySelector(`[data-k="${k}"]`).value.trim();
    const r = { name: v('name'), lat: v('lat') === '' ? null : +v('lat'), lng: v('lng') === '' ? null : +v('lng'), radius_m: v('radius_m') === '' ? null : +v('radius_m') };
    if (tr.dataset.id) r.id = +tr.dataset.id;
    return r;
  }).filter(r => r.name);
  const old = rows.filter(r => r.id), fresh = rows.filter(r => !r.id);
  if (old.length && fail((await sb.from('sites').upsert(old)).error)) return;
  if (fresh.length && fail((await sb.from('sites').insert(fresh)).error)) return;
  await loadRef(); renderSites(); toast('Sites saved');
});

function renderStaff() {
  $('#staffBody').innerHTML = S.staff.map(s => `<tr><td>${esc(s.email)}</td><td>${esc(s.name || '')}</td><td>${esc(s.role)}</td><td>${s.user_id ? '<span class="chip ok">Active</span>' : '<span class="chip">Not signed up</span>'}</td></tr>`).join('');
}
$('#staffForm').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('#sEmail').value.trim().toLowerCase();
  if (!email) return;
  if (fail((await sb.from('staff').insert({ email, name: $('#sName').value.trim() || null, role: $('#sRole').value })).error)) return;
  $('#sEmail').value = $('#sName').value = '';
  await loadRef(); renderStaff(); toast('Added — they can now create their account');
});

function renderRoster() {
  $('#rosterBody').innerHTML = S.emps.map(e => `<tr data-emp="${esc(e.emp_code)}">
    <td class="mono">${esc(e.emp_code)}</td><td>${esc(e.name)}</td><td>${esc(teamName(e.team_id))}</td><td>${esc(e.role)}</td><td>${e.is_pg ? 'PG' : ''}</td>
    <td><input type="checkbox" data-act="active" ${e.active ? 'checked' : ''} aria-label="Active"></td>
    <td>${e.user_id ? '<span class="chip ok">Activated</span>' : `<span class="mono">${esc(e.activation_code || '—')}</span>`} <button class="btn sm" data-act="code">New code</button></td></tr>`).join('');
}
$('#rosterBody').addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const code = b.closest('tr').dataset.emp;
  let ch;
  if (b.dataset.act === 'active') ch = { active: b.checked };
  else {
    if (emp(code).user_id) return toast('Already activated — delete their user in Supabase → Authentication first');
    ch = { activation_code: String(Math.floor(Math.random() * 1e6)).padStart(6, '0') };
  }
  if (fail((await sb.from('employees').update(ch).eq('emp_code', code)).error)) return;
  await loadRef(); renderRoster();
});
$('#copyCodes').addEventListener('click', () => {
  const pend = S.emps.filter(e => e.active && !e.user_id && e.activation_code);
  if (!pend.length) return toast('Everyone is activated');
  copyText(`Stemhub Punch — open ${location.origin}${location.pathname.replace(/desk\.html$/, '')}punch.html → "First time? Activate"\n${pend.map(e => `${e.name} (${e.emp_code}): ${e.activation_code}`).join('\n')}`);
});
$('#saveRoster').addEventListener('click', async () => {
  const rows = [], bad = [];
  for (const line of $('#rosterBox').value.split(/\r?\n/).filter(l => l.trim())) {
    const [code, name, team, role, type] = line.split(',').map(s => (s || '').trim());
    const t = S.teams.find(x => norm(x.name) === norm(team));
    const r = role ? role[0].toUpperCase() + role.slice(1).toLowerCase() : 'Member';
    if (!code || !name || !t || !ROLE_ORDER.hasOwnProperty(r)) { bad.push(line); continue; }
    const row = { emp_code: code.toUpperCase(), name, team_id: t.id, role: r, is_pg: /^pg$/i.test(type || '') };
    if (!emp(row.emp_code)) row.activation_code = String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
    rows.push(row);
  }
  if (bad.length) return toast(`Check these lines (unknown team or role): ${bad.join(' / ')}`);
  if (!rows.length) return;
  // new and existing people in separate calls so existing activation codes are left alone
  const fresh = rows.filter(r => r.activation_code), old = rows.filter(r => !r.activation_code);
  if (fresh.length && fail((await sb.from('employees').insert(fresh)).error)) return;
  if (old.length && fail((await sb.from('employees').upsert(old)).error)) return;
  $('#rosterBox').value = '';
  await loadRef(); renderRoster(); toast(`${rows.length} saved`);
});

/* ---------- Claude (MCP) link ---------- */
const mcpLink = () => `${location.origin}/api/mcp?token=${encodeURIComponent($('#mcpToken').value.trim())}`;
$('#mcpToken').addEventListener('input', () => {
  $('#mcpLink').textContent = $('#mcpToken').value.trim() ? mcpLink().replace(/token=.*/, 'token=••••••') : '';
});
$('#mcpCopy').addEventListener('click', () => {
  if (!$('#mcpToken').value.trim()) return toast('Paste the MCP_TOKEN from Vercel first.');
  copyText(mcpLink());
});

/* ---------- start ---------- */
if (checkConfig()) start();
