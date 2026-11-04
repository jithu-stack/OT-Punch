// Shared helpers for punch.html and desk.html
const CFG = window.STEMHUB_CONFIG;
const sb = supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayIST = () => ymd(new Date(Date.now() + (330 + new Date().getTimezoneOffset()) * 60000));
const hhmm = t => (t ? String(t).slice(0, 5) : '');

function fmt12(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || '');
  if (!m) return t || '';
  let h = +m[1];
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m[2]} ${ap}`;
}
const fmtTs = ts => (ts ? new Date(ts).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '');
const fmtH = h => (h == null ? '–' : String(Math.round(h * 100) / 100));

function toast(msg) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.append(t); }
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 3000);
}

function errText(e) {
  const m = (e && (e.message || e.error_description)) || String(e);
  if (/Database error saving new user/i.test(m)) return 'Not allowed: wrong EMP code / activation code, or email not on the staff list.';
  if (/already registered/i.test(m)) return 'Already activated. Use Log in instead.';
  if (/Invalid login credentials/i.test(m)) return 'Wrong EMP code / email or PIN.';
  if (/row-level security|permission denied/i.test(m)) return 'Your login is not allowed to do this.';
  return m;
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); }
  catch (_) { window.prompt('Copy this text:', text); }
}

function checkConfig() {
  if (/YOUR-/.test(CFG.SUPABASE_URL + CFG.SUPABASE_ANON_KEY)) {
    document.body.innerHTML = '<div class="wrap"><div class="card" style="margin-top:40px"><h2>Not configured yet</h2><p>Open <code>web/config.js</code> and fill in the Supabase Project URL and anon key.</p></div></div>';
    return false;
  }
  return true;
}
