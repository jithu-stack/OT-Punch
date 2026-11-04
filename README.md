# Stemhub OT

Daily OT for the BLR site installation teams: technicians punch on their phones (selfie + GPS),
supervisors check and approve on OT Desk, HR gets the Excel report.

```
supabase/schema.sql   tables, OT calculation (view v_day), punch rules, security
supabase/seed.sql     rules, 13 teams, 35-person roster, first admin
web/punch.html        technician phone app
web/desk.html         OT Desk: board, site allotment, manual/WhatsApp entry, HR report, setup
web/config.js         Supabase URL + anon key (fill in)
```

No build step: `web/` is plain HTML/JS and can be served by any static host.

## 1. Supabase (about 10 minutes)

1. supabase.com → **New project** → region **Mumbai (ap-south-1)**. Save the database password somewhere safe.
2. **SQL Editor** → New query → paste all of `supabase/schema.sql` → **Run**.
3. Open `supabase/seed.sql`. If the admin email on the last line is not yours, change it. Paste it into a new query → **Run**.
4. **Authentication → Sign In / Providers → Email**: turn **Confirm email OFF**.
   Technician logins use made-up addresses (`hr703@punch.stemhub.in`) that cannot receive mail.
5. **Project Settings → API**: copy the **Project URL** and the **anon public** key into `web/config.js`.
   Never use the `service_role` key in the app.

## 2. Try it on this PC

Open `web/desk.html` in a browser, or serve the folder:

```bash
npx serve web
```

(`npx` needs Node.js: `winget install OpenJS.NodeJS.LTS`.) The phone camera and GPS need **https**, so test punching on the hosted site from step 4.

## 3. GitHub

```bash
winget install Git.Git
```

Then in this folder:

```bash
git init
```

```bash
git add .
```

```bash
git commit -m "Stemhub OT: Supabase schema, punch app, OT Desk"
```

Create an **empty private** repository on github.com named `stemhub-ot`, then:

```bash
git remote add origin https://github.com/<your-user>/stemhub-ot.git
```

```bash
git push -u origin main
```

(If git says the branch is `master`, run `git branch -M main` first.)

## 4. Hosting (free)

Netlify or Vercel → **Add new project → Import from GitHub** → pick `stemhub-ot` →
set the **publish/output directory** to `web` and leave the build command empty → Deploy.
Every `git push` redeploys automatically.

## 5. First day

1. Open `https://<your-site>/desk.html` → **Create account** with the admin email from seed.sql.
2. **Setup**: check the rules, add holidays, add sites (stand at the site → "Use my location"), add supervisor/HR emails.
3. **Setup → Roster → Copy activation codes** and send each technician their code.
   Technician: open `https://<your-site>/punch.html` → **First time? Activate** → EMP code + code + choose a 6-digit PIN.
   On Android/iPhone: browser menu → **Add to Home screen**.
4. Each morning: **Site allotment** → site, shift, OPR no. and TA type per team (or "Copy from previous day").
5. Evening: **Today's board** → check flags → **Approve** → **HR report** → **Download Excel**.

## How the day is calculated

| Rule | Where |
|---|---|
| Shift 1 07:00–15:30, Shift 2 08:30–17:00 (8.5 h incl. break) | Setup → rules |
| OT = 2nd punch in → 2nd punch out, rounded **down** to 0.5 h | `v_day` |
| Worked past shift end without OT punches → flagged, not paid | `v_day.past_shift_no_ot` |
| Sunday: work + OT all count as OT ×2; holidays ×2 | `v_day` |
| PG members no OT (helpers do) | `employees.is_pg`, Setup → "PG members earn OT" |
| Travel recorded (3rd pair) but not OT | punch app |
| TA: Local 100 / Factory 0 / Outstation 300 / Night 500 / other | Site allotment, or Edit per person |
| Food: non-PG automatic when work/OT ends ≥ 22:00, otherwise supervisor approval; PG teams only ≥ 22:00 **and** approval | `v_day.food_status` |
| Manual / WhatsApp entries: OT = time beyond the 8.5 h shift | `v_day` |

Only **approved** days go into the HR report.

## Common fixes

- **Forgot PIN**: Supabase → Authentication → Users → delete `<empcode>@punch.stemhub.in` → OT Desk → Setup → Roster → **New code** → send it.
- **Wrong punch** (e.g. pressed "No OT" by mistake): Board → Edit → **Delete last punch**; the technician punches again.
- **"Not allowed" on sign-up**: the EMP code / activation code is wrong, or the staff email was not added in Setup first.

## Still to confirm before go-live

- EMP codes: Amrendra (HR672 vs DM140), Anil Kumar Marko (HR812 vs HR811), Bikram Nayak (HR808 vs HR809), Deepak Paswan HR807.
- 27 or 35 people; HR837 Mausam Kumar.
- Holidays ×2 and PG helper OT (both assumed yes).
- The live OT Desk had rounding 1 h, PG OT on and all TA ₹0 — this seed uses the agreed 0.5 h, PG no OT, TA 100/300/500.
