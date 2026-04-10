// app/dashboard/financial-report/page.tsx
'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { usePermissions } from '@/lib/PermissionsContext';

export default function FinancialReportPage() {
  const router = useRouter();
  const { can } = usePermissions();

  useEffect(() => {
    const target = can('tab:cashflow')
      ? '/dashboard/cashflow'
      : can('tab:financial-settings')
        ? '/dashboard/financial-settings'
        : '/dashboard';
    router.replace(target);
  }, [can, router]);

  return (
    <div style={{ padding: 24, color: 'var(--text-secondary)', fontSize: 13 }}>
      Redirecting…
    </div>
  );
}
