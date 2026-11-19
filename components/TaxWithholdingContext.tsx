'use client';

import React, { createContext, useCallback, useContext, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { SlipStatus } from '@/lib/tax-withholding-domain';
import type { TaxWithholdingEntity } from '@/lib/tax-withholding-actions';

type WorkContext = {
  entityId: number;
  year: number;
  month: number;
  search: string;
  status: SlipStatus | 'all';
  recapView: 'months' | 'year';
};
const initialContext = (entities: TaxWithholdingEntity[] = []): WorkContext => {
  const now = new Date();
  return { entityId: entities.find(entity => entity.is_active)?.id ?? entities[0]?.id ?? 0,
    year: now.getFullYear(), month: now.getMonth() + 1, search: '', status: 'all', recapView: 'months' };
};
const Context = createContext<{ value: WorkContext; setValue: Dispatch<SetStateAction<WorkContext>> } | null>(null);

// Key this provider by workspace: context is shared between sections, never between workspaces.
export function TaxWorkProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState(() => initialContext());
  return <Context.Provider value={{ value, setValue }}>{children}</Context.Provider>;
}

export function useTaxWorkContext(entities: TaxWithholdingEntity[]) {
  const shared = useContext(Context);
  const [local, setLocal] = useState(() => initialContext(entities));
  const value = shared?.value ?? local;
  const setValue = shared?.setValue ?? setLocal;
  const update = useCallback((patch: Partial<WorkContext>) => setValue(current => ({ ...current, ...patch })), [setValue]);
  useEffect(() => {
    if (!entities.some(entity => entity.id === value.entityId)) {
      update({ entityId: entities.find(entity => entity.is_active)?.id ?? entities[0]?.id ?? 0 });
    }
  }, [entities, value.entityId, update]);
  return { ...value, update };
}
