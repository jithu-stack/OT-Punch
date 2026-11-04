-- Stemhub OT — starting data. Run after schema.sql.
-- Roster copied from OT Desk (35 people). Fix the EMP code mismatches before go-live.

-- Agreed rules: OT rounded down to 0.5 h, Sunday & holidays ×2, PG members no OT,
-- TA Local 100 / Factory 0 / Outstation 300 / Night 500, food after 22:00 (₹80 as set in OT Desk).
insert into settings (id, food_amount) values (1, 80)
on conflict (id) do nothing;

insert into holidays (day, name) values
  ('2026-10-02', 'Gandhi Jayanti'),
  ('2026-10-20', 'Holiday')
on conflict do nothing;

insert into teams (name, is_pg, sort) values
  ('INSTALLATION TEAM 1', false, 1),
  ('INSTALLATION TEAM 2', false, 2),
  ('INSTALLATION TEAM 3', false, 3),
  ('INSTALLATION TEAM 4', false, 4),
  ('INSTALLATION TEAM 5', false, 5),
  ('INSTALLATION TEAM 6', false, 6),
  ('INSTALLATION TEAM 7', false, 7),
  ('SLIDETECH INSTALLATION TEAM', false, 8),
  ('PG 1', true, 9),
  ('PG 2', true, 10),
  ('PG 3', true, 11),
  ('SPARE', false, 12),
  ('CHENNAI PG TEAM', true, 13)
on conflict (name) do nothing;

-- activation_code: random 6 digits per person — see them in OT Desk → Setup → Roster
insert into employees (emp_code, name, team_id, role, is_pg, activation_code)
select v.code, v.name, t.id, v.role, v.is_pg, lpad((floor(random() * 1000000))::int::text, 6, '0')
from (values
  ('DM118','Gopal Chakraborty','INSTALLATION TEAM 1','Leader',false),
  ('DM110','Anal Mondal','INSTALLATION TEAM 1','Member',false),
  ('HR611','Koushik Mandal','INSTALLATION TEAM 1','Member',false),
  ('PE033','Dastagirisaba Huseenbhai','INSTALLATION TEAM 2','Leader',false),
  ('HR783','Sagerath Satnami','INSTALLATION TEAM 2','Member',false),
  ('DM145','Raju Ray','INSTALLATION TEAM 2','Member',false),
  ('DM140','Amrendra Kumar Singh','INSTALLATION TEAM 3','Leader',false),
  ('HR703','Mahendra Nayak','INSTALLATION TEAM 3','Member',false),
  ('NE633','Shivanagouda P R','INSTALLATION TEAM 3','Member',false),
  ('DM109','Pintu Mondal','INSTALLATION TEAM 4','Leader',false),
  ('DM107','Alokesh Gayen','INSTALLATION TEAM 4','Member',false),
  ('HR820','Avinash Singh','INSTALLATION TEAM 4','Member',false),
  ('DM112','Prashanta Sethi','INSTALLATION TEAM 5','Leader',false),
  ('PE035','Moniram Khamrui','INSTALLATION TEAM 5','Member',false),
  ('HR808','Deepak Kumar','INSTALLATION TEAM 5','Member',false),
  ('HR828','Malay Mondal','INSTALLATION TEAM 6','Leader',false),
  ('HR809','Bikram Nayak','INSTALLATION TEAM 6','Member',false),
  ('NE485','Sudip Paul','INSTALLATION TEAM 6','Member',false),
  ('HR494','Jayanta Chakroborty','INSTALLATION TEAM 7','Leader',false),
  ('NE628','Bagun Bari','INSTALLATION TEAM 7','Member',false),
  ('NE656','Sudip Mondal','INSTALLATION TEAM 7','Member',false),
  ('HR811','Anil Kumar Marko','SLIDETECH INSTALLATION TEAM','Leader',false),
  ('HR837','Mausam Kumar','SLIDETECH INSTALLATION TEAM','Member',false),
  ('PE067','Yuvaraja M B','PG 1','Leader',true),
  ('HR807','Subhankar Debnath','PG 1','Member',true),
  ('NE418','Mahendra Naskar','PG 1','Helper',false),
  ('HR695','Padmalochan Maharana','PG 2','Leader',true),
  ('HR720','Deep Basar','PG 2','Member',true),
  ('NE636','Ranjith Thakur','PG 2','Helper',false),
  ('HR561','Saorj Sethi','PG 3','Leader',true),
  ('NE612','Anantha Parida','PG 3','Member',true),
  ('NE560','Chandan Kumar Saho','PG 3','Helper',false),
  ('HR836','Sujit Mridha','SPARE','Member',false),
  ('PE018','Rajanikant Behera','CHENNAI PG TEAM','Leader',true),
  ('PE042','Ritesh Kumar Panigrahi','CHENNAI PG TEAM','Member',true)
) as v(code, name, team, role, is_pg)
join teams t on t.name = v.team
on conflict (emp_code) do nothing;

-- First admin: replace with your email, run, then sign up in OT Desk with that email.
insert into staff (email, name, role) values ('a05@stemhub.in', 'Admin', 'admin')
on conflict (email) do nothing;
