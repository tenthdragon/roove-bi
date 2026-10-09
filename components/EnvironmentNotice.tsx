export default function EnvironmentNotice() {
  const environment = process.env.NEXT_PUBLIC_APP_ENV;
  if (environment !== 'staging' && environment !== 'development') return null;
  return (
    <div role="status" style={{ background: '#fef3c7', color: '#78350f', padding: '8px 12px', fontSize: 12, borderRadius: 6, marginBottom: 12 }}>
      {environment === 'staging' ? 'STAGING' : 'DEVELOPMENT'} · Data salinan untuk pengujian.
      Perubahan di sini tidak masuk ke production.
    </div>
  );
}
