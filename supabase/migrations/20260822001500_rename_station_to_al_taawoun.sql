-- Update the visible station identity without changing operational records.
update public.stations
set name = 'التعاون',
    legal_name = 'Al Taawoun'
where name ilike '%petrol%'
   or name ilike '%harbour road%'
   or legal_name ilike '%petrol%'
   or legal_name ilike '%harbour road%';
