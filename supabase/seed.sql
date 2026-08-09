-- ===========================================================================
-- DEMO DATA
--
-- Builds a plausible eight days of operation for a four-tank forecourt so that
-- every screen has something real to show: deliveries that arrive when stock
-- runs low, shift sales that track grade demand, reconciliations with genuine
-- (small) measurement variance, one escalated variance, one pending adjustment
-- and one period awaiting manager review.
--
-- Run automatically by `supabase db reset`. For a hosted project, paste this
-- file into the Supabase SQL editor — it provisions its own auth users and is
-- safe to run twice (it detects the demo station and exits).
-- ===========================================================================

do $seed$
declare
  v_station    uuid := '11111111-1111-4111-8111-111111111111';
  v_manager    uuid := '22222222-2222-4222-8222-222222222222';
  v_supervisor uuid := '33333333-3333-4333-8333-333333333333';

  v_gas92 uuid; v_gas80 uuid; v_diesel uuid;
  v_t01 uuid; v_t02 uuid; v_t03 uuid; v_t04 uuid;
  v_shift_a uuid; v_shift_b uuid; v_shift_c uuid;
  v_sup_misr uuid; v_sup_taqa uuid;

  d          date;
  v_shift    record;
  v_tank     record;
  v_session  uuid;
  v_balance  numeric;
  v_drop     numeric;
  v_sold     numeric;
  v_expected numeric;
  v_actual   numeric;
  v_drift    numeric;
  v_actor    uuid;
begin
  if exists (select 1 from public.stations where id = v_station) then
    raise notice 'Demo station already present — skipping seed.';
    return;
  end if;

  perform setseed(0.4242);

  -- -------------------------------------------------------------------------
  -- Identity
  -- -------------------------------------------------------------------------
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  select
    '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
    u.email, extensions.crypt('ControlDeck!2024', extensions.gen_salt('bf')), now(),
    now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    '', '', '', ''
  from (values
    (v_manager,    'manager@petrol.demo'),
    (v_supervisor, 'supervisor@petrol.demo')
  ) as u(id, email)
  on conflict (id) do nothing;

  insert into auth.identities (
    id, user_id, identity_data, provider, provider_id,
    last_sign_in_at, created_at, updated_at
  )
  select gen_random_uuid(), u.id,
         jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
         'email', u.id::text, now(), now(), now()
  from (values
    (v_manager,    'manager@petrol.demo'),
    (v_supervisor, 'supervisor@petrol.demo')
  ) as u(id, email)
  on conflict do nothing;

  -- Act as the manager for the rest of the seed so audit attribution is real.
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_manager::text, 'role', 'authenticated')::text,
    false
  );

  -- -------------------------------------------------------------------------
  -- Station, people, shifts
  -- -------------------------------------------------------------------------
  insert into public.stations (id, code, name, legal_name, address, city, country_code, timezone, currency_code)
  values (v_station, 'HR01', 'Harbour Road Service Station', 'Harbour Road Fuels Ltd',
          '14 Harbour Road, Dockside Industrial Park', 'Port Said', 'EG', 'Africa/Cairo', 'EGP');

  insert into public.profiles (id, station_id, full_name, email, phone, role, is_active) values
    (v_manager,    v_station, 'Yasmin Fahmy',  'manager@petrol.demo',    '+20 100 555 0142', 'manager',    true),
    (v_supervisor, v_station, 'Karim Nassar',  'supervisor@petrol.demo', '+20 100 555 0187', 'supervisor', true);

  insert into public.shifts (station_id, code, name, starts_at, ends_at, seq) values
    (v_station, 'A', 'Morning',  '06:00', '14:00', 1),
    (v_station, 'B', 'Evening',  '14:00', '22:00', 2),
    (v_station, 'C', 'Night',    '22:00', '06:00', 3);

  select id into v_shift_a from public.shifts where station_id = v_station and code = 'A';
  select id into v_shift_b from public.shifts where station_id = v_station and code = 'B';
  select id into v_shift_c from public.shifts where station_id = v_station and code = 'C';

  -- -------------------------------------------------------------------------
  -- Catalog
  -- -------------------------------------------------------------------------
  insert into public.fuel_types (station_id, code, name, selling_price, purchase_price, color_hex, sort_order, created_by)
  values
    (v_station, 'GAS92', 'Gasoline 92', 13.7500, 12.4000, '#35C2A5', 10, v_manager),
    (v_station, 'GAS80', 'Gasoline 80', 12.2500, 11.1000, '#FFB020', 20, v_manager),
    (v_station, 'DSL',   'Diesel',      10.5000,  9.6000, '#7C8BFF', 30, v_manager)
  returning id into v_gas92;

  select id into v_gas92  from public.fuel_types where station_id = v_station and code = 'GAS92';
  select id into v_gas80  from public.fuel_types where station_id = v_station and code = 'GAS80';
  select id into v_diesel from public.fuel_types where station_id = v_station and code = 'DSL';

  insert into public.suppliers (station_id, code, name, contact_name, contact_phone) values
    (v_station, 'MISR', 'Misr Petroleum',  'Hesham Adel',  '+20 122 400 3311'),
    (v_station, 'TAQA', 'Taqa Distribution', 'Nour Selim', '+20 122 400 7788');

  select id into v_sup_misr from public.suppliers where station_id = v_station and code = 'MISR';
  select id into v_sup_taqa from public.suppliers where station_id = v_station and code = 'TAQA';

  insert into public.tanks (station_id, code, name, fuel_type_id, capacity, max_operating_level, min_safe_level, dead_stock, installed_on, notes, created_by) values
    (v_station, 'T01', 'North bank · 92',  v_gas92,  30000, 28500, 4500, 600, current_date - 1200, 'Primary 92 tank feeding pumps 1–4.', v_manager),
    (v_station, 'T02', 'South bank · 92',  v_gas92,  20000, 19000, 3000, 400, current_date - 980,  'Reserve 92 tank, feeds pumps 5–6.',  v_manager),
    (v_station, 'T03', 'South bank · 80',  v_gas80,  25000, 23800, 3750, 500, current_date - 980,  null, v_manager),
    (v_station, 'T04', 'Truck lane · Diesel', v_diesel, 40000, 38000, 6000, 900, current_date - 1450, 'Serves the HGV lane; highest turnover.', v_manager);

  select id into v_t01 from public.tanks where station_id = v_station and code = 'T01';
  select id into v_t02 from public.tanks where station_id = v_station and code = 'T02';
  select id into v_t03 from public.tanks where station_id = v_station and code = 'T03';
  select id into v_t04 from public.tanks where station_id = v_station and code = 'T04';

  -- -------------------------------------------------------------------------
  -- Opening balances — the first entry in every tank's ledger
  -- -------------------------------------------------------------------------
  perform public.fn_post_transaction(v_t01, 'opening_balance', 21400, current_date - 8, v_shift_a, 'seed', null, 'Stock take at commissioning of the new system', v_manager);
  perform public.fn_post_transaction(v_t02, 'opening_balance', 12250, current_date - 8, v_shift_a, 'seed', null, 'Stock take at commissioning of the new system', v_manager);
  perform public.fn_post_transaction(v_t03, 'opening_balance', 16800, current_date - 8, v_shift_a, 'seed', null, 'Stock take at commissioning of the new system', v_manager);
  perform public.fn_post_transaction(v_t04, 'opening_balance', 28900, current_date - 8, v_shift_a, 'seed', null, 'Stock take at commissioning of the new system', v_manager);

  -- -------------------------------------------------------------------------
  -- Eight days of trading
  -- -------------------------------------------------------------------------
  for i in 0..7 loop
    d := current_date - (7 - i);

    -- Deliveries land in the morning whenever a tank has fallen below half.
    for v_tank in
      select t.id, t.code, t.fuel_type_id, t.capacity, t.max_operating_level, b.quantity
        from public.tanks t join public.tank_balances b on b.tank_id = t.id
       where t.station_id = v_station
       order by t.code
    loop
      select quantity into v_balance from public.tank_balances where tank_id = v_tank.id;

      if v_balance < v_tank.capacity * 0.5 then
        v_drop := floor(least(20000, v_tank.max_operating_level - v_balance) / 500) * 500;

        if v_drop >= 4000 then
          insert into public.deliveries (
            station_id, tank_id, fuel_type_id, supplier_id, business_date, shift_id,
            delivered_at, quantity, unit_cost, tanker_ref, driver_name, reference_no,
            meter_before, meter_after, created_by
          ) values (
            v_station, v_tank.id, v_tank.fuel_type_id,
            case when i % 2 = 0 then v_sup_misr else v_sup_taqa end,
            d, v_shift_a,
            (d + time '08:20') + (random() * interval '90 minutes'),
            v_drop,
            case v_tank.fuel_type_id when v_gas92 then 12.40 when v_gas80 then 11.10 else 9.60 end,
            'TNK-' || lpad((300 + (i * 7) + ascii(v_tank.code))::text, 4, '0'),
            case when i % 2 = 0 then 'Sameh Ragab' else 'Mostafa Lotfy' end,
            'INV-' || to_char(d, 'YYYYMMDD') || '-' || v_tank.code,
            v_balance, v_balance + v_drop,
            v_supervisor
          );
        end if;
      end if;
    end loop;

    -- Shift sales. Volumes are grade-realistic and slightly higher at weekends.
    for v_shift in
      select id, code, seq from public.shifts where station_id = v_station order by seq
    loop
      -- Skip shifts that have not happened yet today.
      exit when d = current_date and v_shift.seq >= 3;

      for v_tank in
        select t.id, t.code, t.fuel_type_id from public.tanks t
         where t.station_id = v_station order by t.code
      loop
        v_sold := case v_tank.fuel_type_id
                    when v_gas92  then 900  + random() * 700
                    when v_gas80  then 700  + random() * 600
                    else               1500 + random() * 1100
                  end
                * case v_shift.seq when 1 then 1.15 when 2 then 1.0 else 0.55 end
                * case when extract(dow from d) in (5, 6) then 1.2 else 1.0 end;

        v_sold := round(v_sold / 5) * 5;

        select quantity into v_balance from public.tank_balances where tank_id = v_tank.id;
        v_sold := least(v_sold, greatest(v_balance - 500, 0));

        if v_sold > 0 then
          insert into public.sales (
            station_id, tank_id, fuel_type_id, business_date, shift_id,
            quantity, pump_label, nozzle_label, created_by
          ) values (
            v_station, v_tank.id, v_tank.fuel_type_id, d, v_shift.id,
            v_sold,
            'P' || substr(v_tank.code, 3, 1),
            case when random() > 0.5 then 'N1' else 'N2' end,
            v_supervisor
          );
        end if;
      end loop;

      -- Reconcile every completed shift.
      if d < current_date then
        perform set_config('request.jwt.claims',
          json_build_object('sub', v_supervisor::text, 'role', 'authenticated')::text, false);

        v_session := public.fn_open_reconciliation(v_station, d, v_shift.id);

        for v_tank in
          select l.tank_id, l.expected_closing_qty, t.code
            from public.reconciliation_lines l
            join public.tanks t on t.id = l.tank_id
           where l.session_id = v_session
        loop
          v_expected := v_tank.expected_closing_qty;

          -- Real forecourts lose a little to evaporation and metering error.
          v_drift := -0.0012 + random() * 0.0016;

          -- One deliberate escalation so the variance screens have teeth.
          if d = current_date - 3 and v_tank.code = 'T04' and v_shift.seq = 2 then
            v_drift := -0.019;
          end if;

          v_actual := round(greatest(v_expected * (1 + v_drift), 0), 1);

          perform public.fn_record_closing_measurement(
            v_session, v_tank.tank_id, v_actual, 'manual', null,
            case when d = current_date - 3 and v_tank.code = 'T04' and v_shift.seq = 2
                 then 'Dip repeated twice. Suspected leak on the HGV lane nozzle — maintenance notified.'
                 else null end
          );
        end loop;

        perform public.fn_submit_reconciliation(v_session, null);

        -- The manager has signed off everything except the last full day, which
        -- is left waiting in the review queue.
        if d < current_date - 1 then
          perform set_config('request.jwt.claims',
            json_build_object('sub', v_manager::text, 'role', 'authenticated')::text, false);
          perform public.fn_review_reconciliation(v_session, true, null);
        end if;

        perform set_config('request.jwt.claims',
          json_build_object('sub', v_manager::text, 'role', 'authenticated')::text, false);
      end if;
    end loop;
  end loop;

  -- -------------------------------------------------------------------------
  -- One adjustment waiting on the manager, raised against the escalated tank
  -- -------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_supervisor::text, 'role', 'authenticated')::text, false);

  insert into public.adjustments (
    station_id, tank_id, fuel_type_id, business_date, shift_id,
    quantity_delta, reason_code, reason, requested_by
  ) values (
    v_station, v_t04, v_diesel, current_date - 1, v_shift_b,
    -140, 'metering_error',
    'Pump 4 nozzle meter was over-reading by roughly 1.8% between the last two calibrations. Requesting a write-off of the difference.',
    v_supervisor
  );

  -- Today's morning stock check, so the dashboard shows a live measured value
  -- alongside the calculated one.
  insert into public.tank_readings (station_id, tank_id, reading_type, source, business_date, shift_id, quantity, recorded_by, notes)
  select v_station, t.id, 'spot', 'manual', current_date, v_shift_a,
         round(b.quantity * (1 - 0.0004 + random() * 0.0006), 1), v_supervisor,
         'Routine morning dip'
    from public.tanks t join public.tank_balances b on b.tank_id = t.id
   where t.station_id = v_station;

  perform set_config('request.jwt.claims', '', false);

  raise notice 'Demo data ready. Sign in as manager@petrol.demo or supervisor@petrol.demo (ControlDeck!2024).';
end
$seed$;
