-- Operators may use their established Arabic or English operational codes.
-- Codes remain required and unique per station; only the display format is flexible.
alter table public.fuel_types drop constraint if exists fuel_types_code_format;
alter table public.fuel_types add constraint fuel_types_code_not_blank check (char_length(btrim(code)) between 1 and 60);

alter table public.tanks drop constraint if exists tanks_code_format;
alter table public.tanks add constraint tanks_code_not_blank check (char_length(btrim(code)) between 1 and 60);
