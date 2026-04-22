type StoreRule = {
  familyCodes: string[];
  storeName: string;
  classifierLabel: string;
};

const SHOPEE_RLT_STORE_RULES: StoreRule[] = [
  {
    familyCodes: ['GLB'],
    storeName: 'Globite Store - Marketplace',
    classifierLabel: 'custom_id family: GLB -> Globite',
  },
  {
    familyCodes: ['PLV'],
    storeName: 'Pluve Main Store - Marketplace',
    classifierLabel: 'custom_id family: PLV -> Pluve',
  },
  {
    familyCodes: ['OGD'],
    storeName: 'Osgard Oil Store',
    classifierLabel: 'custom_id family: OGD -> Osgard',
  },
  {
    familyCodes: ['SRT'],
    storeName: 'Purvu The Secret Store - Markerplace',
    classifierLabel: 'custom_id family: SRT -> Purvu Secret',
  },
  {
    familyCodes: ['PAM'],
    storeName: 'Purvu Store - Marketplace',
    classifierLabel: 'custom_id family: PAM -> Purvu',
  },
  {
    familyCodes: ['YUV'],
    storeName: 'YUV Deodorant Serum Store - Marketplace',
    classifierLabel: 'custom_id family: YUV -> YUV',
  },
  {
    familyCodes: ['DRH'],
    storeName: 'drHyun Main Store - Marketplace',
    classifierLabel: 'custom_id family: DRH -> drHyun',
  },
  {
    familyCodes: ['CLM', 'CAL'],
    storeName: 'Calmara Main Store - Marketplace',
    classifierLabel: 'custom_id family: CAL/CLM -> Calmara',
  },
  {
    familyCodes: ['ROV'],
    storeName: 'Roove Main Store - Marketplace',
    classifierLabel: 'custom_id family: ROV -> Roove',
  },
];

export function classifyShopeeRltStoreByCustomId(customId: string | null | undefined): {
  storeName: string | null;
  classifierLabel: string | null;
} {
  const upper = String(customId || '').toUpperCase().trim();
  if (!upper) {
    return {
      storeName: null,
      classifierLabel: null,
    };
  }

  const matchedRules = SHOPEE_RLT_STORE_RULES.filter((rule) => {
    return rule.familyCodes.some((familyCode) => upper.includes(familyCode));
  });

  if (matchedRules.length !== 1) {
    return {
      storeName: null,
      classifierLabel: null,
    };
  }

  return {
    storeName: matchedRules[0].storeName,
    classifierLabel: matchedRules[0].classifierLabel,
  };
}
