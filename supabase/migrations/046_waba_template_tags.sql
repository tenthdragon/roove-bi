-- 046: Add tags column to waba_templates for user-defined grouping
BEGIN;

ALTER TABLE waba_templates ADD COLUMN tags TEXT[] NOT NULL DEFAULT '{}';
CREATE INDEX idx_waba_templates_tags ON waba_templates USING GIN(tags);

COMMIT;
