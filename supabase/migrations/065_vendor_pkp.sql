-- ============================================================
-- Add PKP (Pengusaha Kena Pajak) status to vendors
-- PKP vendors will have PPN added to PO totals
-- ============================================================

ALTER TABLE warehouse_vendors
  ADD COLUMN IF NOT EXISTS is_pkp BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN warehouse_vendors.is_pkp IS 'PKP = Pengusaha Kena Pajak. If true, PPN is added to PO totals for this vendor.';
