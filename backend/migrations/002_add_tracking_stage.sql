-- Add 'Tracking' to the allowed stage values
ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_stage_check;
ALTER TABLE deals ADD CONSTRAINT deals_stage_check CHECK (stage IN (
  'Screening', 'Due Diligence', 'Invested', 'Passed', 'Lost', 'On Hold', 'Tracking'
));
