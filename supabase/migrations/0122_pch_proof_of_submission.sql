-- Proof of submission upload required before "Mark filed and
-- complete" on a PCH automated case.
--
-- The accountant files via Capium, which hands back a PDF
-- confirmation. We require that PDF to be uploaded before the case
-- can be closed, so there's a durable record on the case of what
-- was actually submitted. Enforced in updateCaseStatusAction (not
-- just the UI); null = still waiting on the proof.

alter table public.pch_cases
  add column if not exists proof_of_submission_path text;

comment on column public.pch_cases.proof_of_submission_path is
  'Storage path (case-documents bucket) of the Capium submission confirmation PDF. Required before cases.status can move filed -> complete.';
