# OT Punch — API documentation

OT Punch has no separate API server. The app talks directly to **Supabase**, which serves a REST API over the tables in [supabase/schema.sql](supabase/schema.sql). Every request is checked by **row level security**, so a login only sees and changes what its role allows.

| | |
|---|---|
| Base URL | `https://azhqeuvusophuldpdexg.supabase.co` |
| REST | `/rest/v1/<table>` and `/rest/v1/rpc/<function>` |
| Auth | `/auth/v1/...` |
| Photos | `/storage/v1/...` (private bucket `punch-photos`) |
| Public key | `sb_publishable_Jpzpkiq8qb0GlDtK6iE4bQ_TBHYlypE` (safe to share; never share the **secret** / `service_role` key) |
| **Swagger UI (try it live)** | https://ot-punch.vercel.app/api-docs.html — spec: [web/openapi.yaml](web/openapi.yaml) |
| Auto-generated docs | https://supabase.com/dashboard/project/azhqeuvusophuldpdexg/api (fills in once schema.sql has run) |

Every request sends two headers:

```
apikey: <public key>
Authorization: Bearer <access_token from sign-in>
```

Times are IST. Dates are `YYYY-MM-DD`. Filters use PostgREST syntax: `?work_date=eq.2026-11-04&select=*`.

---

## 1. Sign in

### Staff (admin / supervisor / HR)
The email must already be in the `staff` table (Setup → Staff logins). The first time, sign up; after that, sign in.

```bash
curl -X POST "https://azhqeuvusophuldpdexg.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: sb_publishable_Jpzpkiq8qb0GlDtK6iE4bQ_TBHYlypE" -H "Content-Type: application/json" \
  -d '{"email":"a05@stemhub.in","password":"<password>"}'
```

The response contains `access_token` (valid for 1 hour) and `refresh_token`. Use the access token as the Bearer token.

Sign up: `POST /auth/v1/signup` with the same body.

### Technician
Login email = `<empcode>@punch.stemhub.in` (lower case), password = the PIN.

| Step | Request |
|---|---|
| Activate (first time) | `POST /auth/v1/signup` — `{"email":"hr703@punch.stemhub.in","password":"<6-digit PIN>","data":{"activation_code":"<code>"}}` |
| Log in | `POST /auth/v1/token?grant_type=password` — `{"email":"hr703@punch.stemhub.in","password":"<PIN>"}` |

Activation fails with *Database error saving new user* when the EMP code or activation code is wrong.

---

## 2. Who can do what

| Data | Technician | HR | Supervisor | Admin |
|---|---|---|---|---|
| `settings`, `holidays`, `teams`, `sites` | read | read | read | read + write |
| `employees` | own row | read | read | read + write |
| `staff` | — | read | read | read + write |
| `allotments` | read | read | read + write | read + write |
| `punches` | own (via `punch()`) | read | read + delete | read + delete |
| `day_reviews` (approve, edit, manual entry) | own, read | read | read + write | read + write |
| `v_day` (calculated day) | own | read | read | read |
| Selfies (`punch-photos`) | upload / read own | read | read | read |

---

## 3. Technician endpoints

### Get today's state — `POST /rest/v1/rpc/punch_state`
Body: `{}`

```json
{
  "emp_code": "HR703", "name": "Ravi Kumar", "team": "INSTALLATION TEAM 2", "work_date": "2026-11-04",
  "site": { "name": "Prestige Lakeside", "shift": "S1", "opr_no": "OPR-24-1187",
            "shift_start": "07:00:00", "shift_end": "15:30:00",
            "ta_type": "local", "ta_amount": 100, "radius": 300 },
  "punches": [ { "kind": "work_in", "at": "2026-11-04T01:32:00+00:00", "dist_m": 40 } ],
  "next": ["work_out"]
}
```

`site` is `null` when the team has no allotment that day. `next` lists the punches allowed now (empty = day complete).

### Punch — `POST /rest/v1/rpc/punch`
Punch order: `work_in → work_out → (ot_in → ot_out | no_ot) → (travel_in → travel_out | no_travel)`.

```json
{ "p_kind": "work_in", "p_lat": 12.9784, "p_lng": 77.7499, "p_accuracy": 12, "p_photo": "HR703/2026-11-04/work_in-1730700000000.jpg" }
```

- Upload the selfie first (section 5), then pass its path as `p_photo`.
- `no_ot` and `no_travel` need no photo or location: send `null` for those fields.
- Returns the new `punch_state`.
- Errors: `Out of order. Next: …`, `Selfie and location are required`, `Not a technician login`.

---

## 4. Supervisor / HR endpoints

### Day board — `GET /rest/v1/v_day?work_date=eq.2026-11-04&select=*`
One row per technician-day. It is calculated from the punches and `day_reviews` using the rules in `settings`.

| Field | Meaning |
|---|---|
| `emp_code`, `name`, `role`, `is_pg`, `team_id`, `team` | Who |
| `status` | `submitted` · `approved` · `query` |
| `source` | `punch` · `form` · `whatsapp` |
| `in_time`, `out_time`, `ot_start`, `ot_end`, `travel_time` | Times |
| `shift`, `shift_start`, `shift_end`, `location`, `opr_no` | Allotment |
| `worked_h` | Hours worked |
| `ot_actual_h` | OT hours, rounded down to `settings.round_h` |
| `mult`, `ot_h` | Multiplier (Sunday / holiday) and paid OT hours = `ot_actual_h × mult` |
| `ta_type`, `ta_amount` | Travel allowance (₹) |
| `food_status` | `auto` · `approved` · `pending` · `noteligible` · `none` |
| `presence` | `VERIFIED` · `OUTSIDE SITE` · `NO PUNCH IN` · `NO PUNCH OUT` · `SITE NOT SET` · `MANUAL` |
| `present` | Final presence (GPS result, or the supervisor's override) |
| `in_dist`, `out_dist`, `radius` | Metres from the site at work in / work out |
| `photo_in`, `photo_out` | Selfie paths in `punch-photos` |
| `complete`, `late_start`, `past_shift_no_ot` | Checks shown as flags on the board |

Only `status = approved` rows go into the HR report.

### Monthly HR list
```
GET /rest/v1/v_day?work_date=gte.2026-10-01&work_date=lte.2026-10-31&status=eq.approved&select=emp_code,name,team,ot_h,ta_amount,food_status&order=team_sort,name
```
Add up `ot_h` and `ta_amount` per `emp_code`.

### Raw punches with GPS — `GET /rest/v1/punches?work_date=eq.2026-11-04&select=emp_code,kind,at,lat,lng,dist_m,photo_path&order=at`

### Approve, query or edit a day — `POST /rest/v1/day_reviews`
Header `Prefer: resolution=merge-duplicates` turns the insert into an upsert on `(emp_code, work_date)`.

```json
{ "emp_code": "HR703", "work_date": "2026-11-04", "status": "approved",
  "approved_by": "<your user id>", "approved_at": "2026-11-04T18:30:00+05:30" }
```

| Action | Fields |
|---|---|
| Approve | `status: "approved"`, `approved_by`, `approved_at` |
| Reopen | `status: "submitted"` |
| Query | `status: "query"`, `note: "<question>"` |
| Confirm presence | `present: true` |
| Approve food | `food_approved: true` |
| Manual / WhatsApp entry | `source: "form"` or `"whatsapp"`, plus `in_time`, `out_time`, `shift`, `location`, `opr_no`, `ta_type`, `ta_amount`, `travel_time`, `remark` |

### Site allotment — `POST /rest/v1/allotments` (upsert, same `Prefer` header)
```json
{ "work_date": "2026-11-05", "team_id": 2, "site_id": 4, "shift": "S2", "opr_no": "07-26-KA-015", "ta_type": "local" }
```

### Delete a wrong punch — `DELETE /rest/v1/punches?emp_code=eq.HR703&work_date=eq.2026-11-04&kind=eq.no_ot`

### Reference data (read)
`GET /rest/v1/employees`, `/teams?order=sort`, `/sites?order=name`, `/holidays?order=day`, `/settings?id=eq.1`, `/staff`

---

## 5. Selfies

| Action | Request |
|---|---|
| Upload (technician) | `POST /storage/v1/object/punch-photos/<EMPCODE>/<date>/<kind>-<ms>.jpg` with the JPEG as the body and `Content-Type: image/jpeg`. The first folder must be your own EMP code. |
| View (staff) | `POST /storage/v1/object/sign/punch-photos/<path>` — body `{"expiresIn":300}` — returns a `signedURL` valid for 5 minutes |

---

## 6. MCP servers (use the data from Claude)

### OT Punch MCP (for supervisors and HR, read-only)
```
https://ot-punch.vercel.app/api/mcp?token=<MCP_TOKEN>
```
This is a Vercel function ([api/mcp.js](api/mcp.js)) using MCP Streamable HTTP. It has four tools: `day_board`, `needs_attention`, `monthly_report` and `employee_history`. It reads Supabase as an **HR** login, so it cannot change data.

Setup:
1. Add `mcp@stemhub.in` as **hr** in OT Desk → Setup → Staff logins, then *Create account* with a strong password.
2. In Vercel, set the env vars `MCP_TOKEN`, `MCP_EMAIL` and `MCP_PASSWORD`, then redeploy.
3. Copy the link from OT Desk → Setup → **Connect Claude (MCP)**, or see https://ot-punch.vercel.app/api-docs.html#mcp.
4. Add it in Claude → Settings → Connectors → *Add custom connector*.

Changing `MCP_TOKEN` revokes every copy of the link.

### Supabase MCP (admin: schema and SQL)

Supabase runs an official MCP server, so nothing needs to be hosted. Claude signs in with **your** Supabase account in the browser; no key is stored.

**Link for this project:**
```
https://mcp.supabase.com/mcp?project_ref=azhqeuvusophuldpdexg
```

Read-only (Claude can query but not change data):
```
https://mcp.supabase.com/mcp?project_ref=azhqeuvusophuldpdexg&read_only=true
```

**Add it to Claude Code** (run in this folder):
```bash
claude mcp add --scope project --transport http supabase "https://mcp.supabase.com/mcp?project_ref=azhqeuvusophuldpdexg"
```
Then start `claude` in a terminal, type `/mcp`, choose **supabase → Authenticate**, and sign in to Supabase in the browser.

**Claude Desktop / claude.ai:** Settings → Connectors → Add custom connector → paste the link.

**What Claude can then do:** run SQL (for example *"today's flagged technicians"* or *"October OT per person"*), list tables, apply schema changes, read logs and generate TypeScript types.

**Careful:** the full link can change data. Use `read_only=true` for HR and reporting, and keep the full link for admin work only.

Docs: https://supabase.com/docs/guides/getting-started/mcp
