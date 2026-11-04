// Technician phone app: 3 punch pairs with selfie + GPS
const STEPS = [
  { kind: 'work_in', label: 'Work start', skip: null },
  { kind: 'work_out', label: 'Work end', skip: null },
  { kind: 'ot_in', label: 'OT start', skip: 'no_ot' },
  { kind: 'ot_out', label: 'OT end', skip: 'no_ot' },
  { kind: 'travel_in', label: 'Travel start', skip: 'no_travel' },
  { kind: 'travel_out', label: 'Travel end', skip: 'no_travel' },
];
const BUTTON = {
  work_in: 'Punch IN — start work', work_out: 'Punch OUT — end work',
  ot_in: 'OT IN — start overtime', ot_out: 'OT OUT — end overtime', no_ot: 'No OT today',
  travel_in: 'Travel IN — start travel', travel_out: 'Travel OUT — end travel', no_travel: 'No travel today',
};

let mode = 'login';
let state = null;
let pendingKind = null;
let busy = false;

const empEmail = code => `${code.trim().toLowerCase()}@${CFG.TECH_EMAIL_DOMAIN}`;

/* ---------- login ---------- */
function setMode(m) {
  mode = m;
  $$('#loginMode button').forEach(b => b.setAttribute('aria-pressed', b.dataset.m === m));
  $('#actField').hidden = $('#pin2Field').hidden = m !== 'activate';
  $('#lPinLabel').textContent = m === 'activate' ? 'Choose a 6-digit PIN' : '6-digit PIN';
  $('#loginBtn').textContent = m === 'activate' ? 'Activate' : 'Log in';
  $('#loginMsg').textContent = '';
}
$('#loginMode').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setMode(b.dataset.m); });

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const emp = $('#lEmp').value.trim(), pin = $('#lPin').value.trim();
  const msg = $('#loginMsg');
  if (!emp || !/^\d{6,}$/.test(pin)) { msg.textContent = 'Enter your EMP code and a PIN of at least 6 digits.'; return; }
  $('#loginBtn').disabled = true; msg.textContent = 'Please wait…';
  try {
    if (mode === 'activate') {
      if (pin !== $('#lPin2').value.trim()) throw new Error('The two PINs do not match.');
      const { data, error } = await sb.auth.signUp({ email: empEmail(emp), password: pin, options: { data: { activation_code: $('#lAct').value.trim() } } });
      if (error) throw error;
      if (!data.session) throw new Error('Activated. Ask your admin to turn off "Confirm email" in Supabase, then log in.');
    } else {
      const { error } = await sb.auth.signInWithPassword({ email: empEmail(emp), password: pin });
      if (error) throw error;
    }
    msg.textContent = '';
    await showPunch();
  } catch (err) {
    msg.textContent = errText(err);
  } finally {
    $('#loginBtn').disabled = false;
  }
});

$('#logoutBtn').addEventListener('click', async () => { await sb.auth.signOut(); showLogin(); });

function showLogin() {
  $('#loginView').hidden = false; $('#punchView').hidden = true; $('#logoutBtn').hidden = true;
  setMode('login');
}

/* ---------- punch screen ---------- */
async function showPunch() {
  $('#loginView').hidden = true; $('#punchView').hidden = false; $('#logoutBtn').hidden = false;
  await load();
}

async function load() {
  $('#status').textContent = '';
  const { data, error } = await sb.rpc('punch_state');
  if (error) {
    if (/Not a technician/i.test(error.message)) { await sb.auth.signOut(); showLogin(); $('#loginMsg').textContent = 'This login is not a technician account.'; return; }
    $('#status').textContent = errText(error); return;
  }
  state = data; render();
}

const TA_LABEL = { local: 'Local', factory: 'Factory', outstation: 'Outstation', night: 'Night journey', custom: 'Other' };
const km = v => (v >= 1000 ? (v / 1000).toFixed(1) + ' km' : v + ' m');

function render() {
  const s = state, site = s.site;
  $('#avatar').textContent = s.name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  $('#who').textContent = s.name;
  $('#whoSub').innerHTML = `<span class="mono">${esc(s.emp_code)}</span>${s.team ? ' · ' + esc(s.team) : ''}`;
  $('#workDate').textContent = s.work_date;
  const fact = (k, v, mono) => `<div><div class="label">${k}</div><div class="val${mono ? ' mono' : ''}">${esc(v)}</div></div>`;
  $('#facts').innerHTML = site
    ? fact('Shift', site.shift_start ? `${hhmm(site.shift_start)}–${hhmm(site.shift_end)}` : site.shift === 'S2' ? 'Shift 2' : 'Shift 1', true)
      + fact('OPR no.', site.opr_no || '—', true) + fact('Site', site.name || 'Not set')
      + fact('Travel allowance', `${TA_LABEL[site.ta_type] || 'Local'}${site.ta_amount != null ? ' · ₹ ' + site.ta_amount : ''}`)
    : fact('Site', 'Not allotted today') + fact('Note', 'Punch anyway');

  const done = new Map(s.punches.map(p => [p.kind, p]));
  const next = new Set(s.next);
  $('#steps').innerHTML = STEPS.map(st => {
    const p = done.get(st.kind);
    const skipped = st.skip && done.has(st.skip);
    const cls = p ? 'done' : skipped ? 'skip' : next.has(st.kind) ? 'next' : 'pending';
    const at = p && p.dist_m != null && site && site.radius ? p.dist_m <= site.radius : null;
    const chip = p ? (at === null ? (p.dist_m != null ? `<span class="chip">${km(p.dist_m)}</span>` : '')
      : `<span class="chip ${at ? 'ok' : 'bad'}">${at ? 'At site' : 'Outside site'}</span>`)
      : skipped ? '<span class="chip">Skipped</span>' : '';
    const icon = p ? 'check' : skipped ? 'minus' : next.has(st.kind) ? 'camera' : 'circle';
    return `<li class="${cls}"><span class="dot"><i class="icon-${icon}"></i></span><span class="lbl">${esc(st.label)}</span><span class="tm">${p ? esc(fmtTs(p.at)) : '—'}</span>${chip}</li>`;
  }).join('');

  const main = s.next.find(k => !k.startsWith('no_'));
  const step = STEPS.find(x => x.kind === main);
  if (!$('#status').textContent && step) $('#status').innerHTML = `<i class="icon-clock"></i><span>Next: ${esc(step.label)}.</span>`;
  $('#actions').innerHTML = s.next.length
    ? (main ? `<button class="punchbtn" data-kind="${main}"><span class="ring"><i class="icon-camera"></i></span><span><span class="verb">${main.endsWith('_in') ? 'Punch in' : 'Punch out'}</span><br><span class="what">${esc(step.label)}</span></span></button>` : '')
      + s.next.filter(k => k.startsWith('no_')).map(k => `<button class="skipbtn" data-kind="${k}"><i class="icon-circle-slash"></i>${esc(BUTTON[k])}</button>`).join('')
    : `<div class="done-card"><span class="tick"><i class="icon-check"></i></span><b>All punches for today are complete.</b><span class="muted">Sent to your supervisor for approval.</span></div>`;
}

$('#refreshBtn').addEventListener('click', load);

$('#actions').addEventListener('click', async e => {
  const b = e.target.closest('button[data-kind]');
  if (!b || busy) return;
  const kind = b.dataset.kind;
  if (kind.startsWith('no_')) {
    if (!confirm(`${BUTTON[kind]}?`)) return;
    await doPunch(kind, null, null);
  } else {
    pendingKind = kind;
    $('#camera').value = '';
    $('#camera').click(); // selfie first, then location
  }
});

$('#camera').addEventListener('change', async () => {
  const file = $('#camera').files[0];
  if (!file || !pendingKind) return;
  const kind = pendingKind; pendingKind = null;
  setBusy(true, 'Getting your location…');
  try {
    const [photo, pos] = await Promise.all([shrink(file), getPosition()]);
    setBusy(true, 'Uploading selfie…');
    const path = `${state.emp_code}/${state.work_date}/${kind}-${Date.now()}.jpg`;
    const { error } = await sb.storage.from('punch-photos').upload(path, photo, { contentType: 'image/jpeg' });
    if (error) throw error;
    await doPunch(kind, pos, path);
  } catch (err) {
    setBusy(false, errText(err));
  }
});

async function doPunch(kind, pos, path) {
  setBusy(true, 'Saving punch…');
  const { data, error } = await sb.rpc('punch', {
    p_kind: kind,
    p_lat: pos ? pos.coords.latitude : null,
    p_lng: pos ? pos.coords.longitude : null,
    p_accuracy: pos ? pos.coords.accuracy : null,
    p_photo: path,
  });
  if (error) { setBusy(false, errText(error)); return; }
  state = data; render();
  setBusy(false, `Saved: ${BUTTON[kind]}`);
}

function setBusy(on, text) {
  busy = on;
  $$('#actions button').forEach(b => (b.disabled = on));
  $('#status').innerHTML = text ? `<i class="icon-${on ? 'loader' : 'info'}"></i><span>${esc(text)}</span>` : '';
}

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This phone cannot share location.'));
    navigator.geolocation.getCurrentPosition(resolve,
      err => reject(new Error(err.code === 1 ? 'Location permission denied. Allow location for this site and try again.' : 'Could not get location. Go outside / turn on GPS and try again.')),
      { enableHighAccuracy: true, timeout: 25000, maximumAge: 0 });
  });
}

// Resize selfie to max 800 px JPEG so uploads are quick on mobile data
function shrink(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 800 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      c.toBlob(b => (b ? resolve(b) : reject(new Error('Could not read the photo.'))), 'image/jpeg', 0.75);
    };
    img.onerror = () => reject(new Error('Could not read the photo.'));
    img.src = URL.createObjectURL(file);
  });
}

/* ---------- start ---------- */
(async () => {
  if (!checkConfig()) return;
  const { data } = await sb.auth.getSession();
  if (data.session) showPunch(); else showLogin();
})();
