-- Migration 080: Remove hardcoded CHECK constraint on warehouse_business_mapping.deduct_entity
-- Allows dynamic entity values instead of only ('RTI','RLB','JHN','RLT')
ALTER TABLE warehouse_business_mapping DROP CONSTRAINT IF EXISTS warehouse_business_mapping_deduct_entity_check;
