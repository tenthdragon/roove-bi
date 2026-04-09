// app/dashboard/financial-report/page.tsx
'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function FinancialReportPage() {
  const router = useRouter();
  useEffect(() => { router.replace('/dashboard/cashflow'); }, []);
  return (
    <div style={{ padding: 24, color: 'var(--text-secondary)', fontSize: 13 }}>
      Redirecting…
    </div>
  );
}
