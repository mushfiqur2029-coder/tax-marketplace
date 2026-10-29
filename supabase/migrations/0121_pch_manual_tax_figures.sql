-- Manual tax figures for the SA Tax Return forwarding letter.
--
-- Previously generateSaForwardingLetterPdf() read the three money
-- amounts (tax liability, due by 31 Jan, due by 31 Jul) off
-- snapshot.tax.*. The accountant now files via Capium and keys the
-- real HMRC-stamped figures in by hand before generating the letter,
-- so those three amounts stop being auto-calculated and become
-- client-of-record on pch_cases, written from the accountant's
-- "Generate documents" panel inputs.
--
-- Three integers (pence). All nullable until the accountant fills
-- them in; the generate action refuses to proceed if any of them is
-- still null when "Generate documents" is clicked.

alter table public.pch_cases
  add column if not exists manual_tax_liability_pence integer,
  add column if not exists manual_tax_due_jan_pence integer,
  add column if not exists manual_tax_due_jul_pence integer;

comment on column public.pch_cases.manual_tax_liability_pence is
  'Accountant-typed tax liability for the year (pence). Fed into the SA Tax Return forwarding letter; replaces the old snapshot.tax.totalTaxAndNic read.';
comment on column public.pch_cases.manual_tax_due_jan_pence is
  'Accountant-typed tax due by 31 January (pence). Fed into the SA Tax Return forwarding letter.';
comment on column public.pch_cases.manual_tax_due_jul_pence is
  'Accountant-typed tax due by 31 July (pence). Fed into the SA Tax Return forwarding letter.';
