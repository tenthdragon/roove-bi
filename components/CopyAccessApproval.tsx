'use client';

import { useEffect, useId, useState } from 'react';

type Props = {
  email: string;
  fullName?: string | null;
  roleLabel: string;
  workspaceName: string;
};

export default function CopyAccessApproval({ email, fullName, roleLabel, workspaceName }: Props) {
  const [loginUrl, setLoginUrl] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [copying, setCopying] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const previewId = useId();

  useEffect(() => {
    // The login page lives at the root of the current app environment.
    setLoginUrl(new URL('/', window.location.origin).href);
  }, []);

  const message = [
    `Halo ${fullName?.trim() || email},`,
    '',
    `Akses Anda ke Roove BI untuk workspace ${workspaceName} telah disetujui.`,
    '',
    `Email: ${email}`,
    `Role: ${roleLabel}`,
    `Login: ${loginUrl}`,
    '',
    'Silakan login menggunakan email di atas dan password akun Anda.',
  ].join('\n');

  const copyMessage = async () => {
    setCopying(true);
    setCopyStatus('');
    try {
      await navigator.clipboard.writeText(message);
      setCopyStatus('Pesan persetujuan berhasil disalin. Siap dikirim ke user.');
    } catch {
      setShowPreview(true);
      setCopyStatus('Browser tidak mengizinkan salin otomatis. Pilih dan salin pesan di bawah secara manual.');
    } finally {
      setCopying(false);
    }
  };

  return (
    <div style={{ flexBasis: '100%', display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          onClick={copyMessage}
          disabled={!loginUrl || copying}
          aria-label={`Salin pesan persetujuan untuk ${email}`}
          style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', cursor: copying ? 'wait' : 'pointer', fontSize: 12, fontWeight: 600 }}
        >
          {copying ? 'Menyalin…' : 'Salin pesan persetujuan'}
        </button>
        <button
          type="button"
          onClick={() => setShowPreview(!showPreview)}
          aria-expanded={showPreview}
          aria-controls={previewId}
          style={{ padding: '6px 0', border: 'none', background: 'transparent', color: 'var(--dim)', cursor: 'pointer', fontSize: 12 }}
        >
          {showPreview ? 'Tutup pesan' : 'Lihat pesan'}
        </button>
      </div>
      {copyStatus && <div role="status" style={{ fontSize: 12, color: 'var(--dim)' }}>{copyStatus}</div>}
      {showPreview && (
        <textarea
          id={previewId}
          aria-label={`Pesan persetujuan untuk ${email}`}
          readOnly
          value={message}
          rows={10}
          onFocus={(event) => event.currentTarget.select()}
          style={{ width: '100%', boxSizing: 'border-box', padding: 10, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12, lineHeight: 1.6, resize: 'vertical' }}
        />
      )}
    </div>
  );
}
