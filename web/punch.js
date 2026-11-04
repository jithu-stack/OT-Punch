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

function render() {
  const s = state;
  $('#who').textContent = `${s.name} · ${s.emp_code}`;
  $('#where').textContent = [s.team, s.site ? `Site: ${s.site.name || 'not set'} · ${s.site.shift === 'S2' ? 'Shift 2' : 'Shift 1'}${s.site.opr_no ? ' · OPR ' + s.site.opr_no : ''}` : 'No site allotted today — punch anyway'].filter(Boolean).join(' · ');
  $('#workDate').textContent = s.work_date;
  const done = new Map(s.punches.map(p => [p.kind, p]));
  const next = new Set(s.next);
  $('#steps').innerHTML = STEPS.map(st => {
    const p = done.get(st.kind);
    const skipped = st.skip && done.has(st.skip);
    const cls = p ? 'done' : skipped ? 'skip' : next.has(st.kind) ? 'next' : '';
    const right = p ? `${fmtTs(p.at)}${p.dist_m != null ? ` · ${p.dist_m >= 1000 ? (p.dist_m / 1000).toFixed(1) + ' km' : p.dist_m + ' m'}` : ''}` : skipped ? 'skipped' : '';
    return `<li class="${cls}"><span>${esc(st.label)}</span><span class="mono">${esc(right)}</span></li>`;
  }).join('');
  $('#actions').innerHTML = s.next.length
    ? s.next.map(k => `<button class="btn big ${k.startsWith('no_') ? '' : 'primary'}" data-kind="${k}">${esc(BUTTON[k])}</button>`).join('')
    : '<div class="card" style="text-align:center"><b>Day complete ✓</b><p class="muted" style="margin:4px 0 0">All punches done. See you tomorrow.</p></div>';
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
  $('#status').textContent = text || '';
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
