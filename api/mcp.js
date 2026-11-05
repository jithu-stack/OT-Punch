// OT Punch MCP server (Streamable HTTP, stateless, read-only) — Vercel function at /api/mcp
// Claude connects with:  https://<site>/api/mcp?token=<MCP_TOKEN>
// Vercel env vars: MCP_TOKEN (any long random string), MCP_EMAIL + MCP_PASSWORD (an HR staff login).
// It reads Supabase as that HR login, so row level security keeps it read-only.
// OT, TA and food are calculated in the database (view v_day); this file only filters and adds up.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://azhqeuvusophuldpdexg.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_Jpzpkiq8qb0GlDtK6iE4bQ_TBHYlypE';
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const todayIST = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

/* ---------- Supabase (signed in as the HR login, token cached while warm) ---------- */
let session = null;
async function token() {
  if (session && session.expires > Date.now() + 60000) return session.access_token;
  if (!process.env.MCP_EMAIL || !process.env.MCP_PASSWORD) throw new Error('Server not configured: set MCP_EMAIL and MCP_PASSWORD in Vercel.');
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.MCP_EMAIL, password: process.env.MCP_PASSWORD }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error('Supabase sign-in failed: ' + (j.error_description || j.msg || r.status));
  session = { access_token: j.access_token, expires: Date.now() + j.expires_in * 1000 };
  return session.access_token;
}
async function db(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${await token()}` } });
  const j = await r.json();
  if (!r.ok) throw new Error(j.message || `Supabase error ${r.status}`);
  return j;
}

const DAY_FIELDS = 'emp_code,name,team,role,status,source,in_time,out_time,ot_start,ot_end,shift,location,opr_no,worked_h,ot_actual_h,mult,ot_h,ta_type,ta_amount,food_status,presence,present,in_dist,out_dist,complete,late_start,past_shift_no_ot,max_ot_h,max_duty_h,note';
const hm = t => (t ? String(t).slice(0, 5) : null);

function flagsOf(d) {
  const f = [];
  if (!d.in_time || !d.out_time) f.push('Start or end time missing');
  if (d.presence === 'OUTSIDE SITE') f.push(`Punched away from site (in ${d.in_dist ?? '?'} m, out ${d.out_dist ?? '?'} m)`);
  if (d.presence === 'NO PUNCH IN' || d.presence === 'NO PUNCH OUT') f.push(d.presence === 'NO PUNCH IN' ? 'No punch in' : 'No punch out');
  if (d.source === 'punch' && !d.complete && d.in_time && d.out_time) f.push('OT / travel punches not finished');
  if (d.late_start) f.push('Late start');
  if (d.past_shift_no_ot) f.push('Worked past shift end without OT punch (not paid)');
  if (d.worked_h > d.max_duty_h) f.push(`Duty over ${d.max_duty_h} h`);
  if (d.ot_actual_h > d.max_ot_h) f.push(`OT over ${d.max_ot_h} h`);
  if (d.food_status === 'pending') f.push('Food needs supervisor approval');
  if (!d.present) f.push('Presence not confirmed');
  if (d.status === 'query') f.push('Query: ' + (d.note || ''));
  return f;
}
const slim = d => ({
  emp_code: d.emp_code, name: d.name, team: d.team, status: d.status, source: d.source,
  work: d.in_time ? `${hm(d.in_time)}–${hm(d.out_time) || '?'}` : null,
  ot: d.ot_start ? `${hm(d.ot_start)}–${hm(d.ot_end) || '?'}` : null,
  ot_h: +d.ot_h, ta_amount: d.ta_amount, food: d.food_status, presence: d.presence,
  location: d.location, opr_no: d.opr_no,
});

/* ---------- tools ---------- */
const TOOLS = [
  {
    name: 'day_board',
    description: 'Board for one working day: every active technician with times, paid OT hours, travel allowance, presence and approval status, plus who has not reported. Use for "who punched in today", "today\'s OT", "who hasn\'t reported".',
    inputSchema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD (IST). Default: today.' }, team: { type: 'string', description: 'Optional team name filter, e.g. "TEAM 3".' } } },
    async run({ date, team }) {
      date = isDate(date) ? date : todayIST();
      const [days, emps, teams] = await Promise.all([
        db(`v_day?select=${DAY_FIELDS}&work_date=eq.${date}&order=team_sort,name`),
        db('employees?select=emp_code,name,team_id,active&active=eq.true'),
        db('teams?select=id,name'),
      ]);
      const tname = id => (teams.find(t => t.id === id) || {}).name || 'NO TEAM';
      const match = n => !team || (n || '').toUpperCase().includes(team.toUpperCase());
      const rows = days.filter(d => match(d.team));
      const seen = new Set(days.map(d => d.emp_code));
      const missing = emps.filter(e => !seen.has(e.emp_code) && match(tname(e.team_id))).map(e => ({ emp_code: e.emp_code, name: e.name, team: tname(e.team_id) }));
      const sum = (k) => rows.reduce((s, d) => s + (+d[k] || 0), 0);
      return {
        date, team: team || 'all',
        summary: { reported: rows.length, not_reported: missing.length, approved: rows.filter(d => d.status === 'approved').length,
          needs_attention: rows.filter(d => d.status !== 'approved' && flagsOf(d).length).length, total_ot_h: sum('ot_h'), total_ta_rs: sum('ta_amount') },
        technicians: rows.map(slim), not_reported: missing,
      };
    },
  },
  {
    name: 'needs_attention',
    description: 'Technicians flagged on a working day (late start, outside site, missing punches, OT over limit, presence not confirmed, food approval, queries) that are not yet approved. Use for "who needs checking today".',
    inputSchema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD (IST). Default: today.' } } },
    async run({ date }) {
      date = isDate(date) ? date : todayIST();
      const days = await db(`v_day?select=${DAY_FIELDS}&work_date=eq.${date}&status=neq.approved&order=team_sort,name`);
      const flagged = days.map(d => ({ ...slim(d), flags: flagsOf(d) })).filter(d => d.flags.length);
      return { date, count: flagged.length, technicians: flagged };
    },
  },
  {
    name: 'monthly_report',
    description: 'HR allowance list for a month: per technician the total paid OT hours (Sunday/holiday already ×2), travel allowance ₹ and food-allowance days. Only supervisor-approved days count. Use for "October OT per person", "total TA this month".',
    inputSchema: { type: 'object', required: ['month'], properties: { month: { type: 'string', description: 'YYYY-MM, e.g. 2026-10' }, team: { type: 'string', description: 'Optional team name filter.' } } },
    async run({ month, team }) {
      if (!/^\d{4}-\d{2}$/.test(month || '')) throw new Error('month must be YYYY-MM');
      const [y, m] = month.split('-').map(Number);
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const rows = await db(`v_day?select=emp_code,name,team,ot_h,ta_amount,food_status&status=eq.approved&and=(work_date.gte.${month}-01,work_date.lte.${month}-${last})&order=team_sort,name`);
      const by = new Map();
      for (const d of rows) {
        if (team && !(d.team || '').toUpperCase().includes(team.toUpperCase())) continue;
        const r = by.get(d.emp_code) || { emp_code: d.emp_code, name: d.name, team: d.team, days: 0, ot_h: 0, ta_rs: 0, food_days: 0 };
        r.days++; r.ot_h += +d.ot_h || 0; r.ta_rs += +d.ta_amount || 0;
        if (d.food_status === 'auto' || d.food_status === 'approved') r.food_days++;
        by.set(d.emp_code, r);
      }
      const list = [...by.values()];
      return { month, team: team || 'all', note: 'Approved days only.', totals: { people: list.length, ot_h: list.reduce((s, r) => s + r.ot_h, 0), ta_rs: list.reduce((s, r) => s + r.ta_rs, 0) }, technicians: list };
    },
  },
  {
    name: 'employee_history',
    description: 'Day-by-day record for one technician between two dates: times, OT, TA, presence, status and flags. Use for "show HR703 this week".',
    inputSchema: { type: 'object', required: ['emp_code'], properties: { emp_code: { type: 'string', description: 'EMP code, e.g. HR703' }, from: { type: 'string', description: 'YYYY-MM-DD, default 7 days ago' }, to: { type: 'string', description: 'YYYY-MM-DD, default today' } } },
    async run({ emp_code, from, to }) {
      const code = String(emp_code || '').trim().toUpperCase();
      if (!/^[A-Z0-9]+$/.test(code)) throw new Error('emp_code looks wrong');
      to = isDate(to) ? to : todayIST();
      from = isDate(from) ? from : new Date(Date.parse(to) - 6 * 86400000).toISOString().slice(0, 10);
      const rows = await db(`v_day?select=work_date,${DAY_FIELDS}&emp_code=eq.${code}&and=(work_date.gte.${from},work_date.lte.${to})&order=work_date`);
      return { emp_code: code, from, to, days: rows.map(d => ({ date: d.work_date, ...slim(d), flags: flagsOf(d) })) };
    },
  },
];

/* ---------- JSON-RPC / MCP ---------- */
async function handle(msg) {
  const { id, method, params = {} } = msg || {};
  const ok = result => ({ jsonrpc: '2.0', id, result });
  const err = (code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
  if (id === undefined) return null; // notification (e.g. notifications/initialized)
  switch (method) {
    case 'initialize': {
      const v = PROTOCOL_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOL_VERSIONS[0];
      return ok({ protocolVersion: v, capabilities: { tools: {} }, serverInfo: { name: 'ot-punch', version: '1.0.0' },
        instructions: 'Read-only OT Punch data for BLR site installation teams. Dates are IST. OT hours in results are already paid hours (Sunday/holiday ×2, rounded down). Monthly reports count approved days only.' });
    }
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema, annotations: { readOnlyHint: true } })) });
    case 'tools/call': {
      const tool = TOOLS.find(t => t.name === params.name);
      if (!tool) return err(-32602, `Unknown tool: ${params.name}`);
      try {
        const data = await tool.run(params.arguments || {});
        return ok({ content: [{ type: 'text', text: JSON.stringify(data, null, 1) }] });
      } catch (e) {
        return ok({ content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true });
      }
    }
    default: return err(-32601, `Method not found: ${method}`);
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const expected = process.env.MCP_TOKEN;
  const given = (req.query && req.query.token) || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!expected) return res.status(503).json({ error: 'MCP not configured: set MCP_TOKEN in Vercel.' });
  if (given !== expected) return res.status(401).json({ error: 'Missing or wrong token.' });

  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Use POST (MCP Streamable HTTP).' }); }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); } }
  const out = Array.isArray(body) ? (await Promise.all(body.map(handle))).filter(Boolean) : await handle(body);
  if (!out || (Array.isArray(out) && !out.length)) return res.status(202).end();
  res.status(200).json(out);
};
