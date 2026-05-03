'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  getAllowedEmailDomainsLabel,
  getDefaultSignupEmailPlaceholder,
  isAllowedSignupEmail,
} from '@/lib/site-config';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const normalizedEmail = email.trim().toLowerCase();

    // Validate domain
    if (!isAllowedSignupEmail(normalizedEmail)) {
      setError(`Hanya email ${getAllowedEmailDomainsLabel()} yang dapat mendaftar.`);
      setLoading(false);
      return;
    }

    // Validate password match
    if (password !== confirmPassword) {
      setError('Password tidak sama.');
      setLoading(false);
      return;
    }

    if (password.length < 6) {
      setError('Password minimal 6 karakter.');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: normalizedEmail,
          password,
          fullName,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Terjadi kesalahan');
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Terjadi kesalahan');
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    width: '100%', padding: '10px 14px', borderRadius: 8,
    border: '1px solid var(--border)', background: 'var(--bg)',
    color: 'var(--text)', fontSize: 16, outline: 'none',
  };

  const labelStyle = {
    display: 'block' as const, fontSize: 12, fontWeight: 600, color: 'var(--dim)',
    marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: '0.05em',
  };
  const allowedDomainsLabel = getAllowedEmailDomainsLabel();
  const emailPlaceholder = getDefaultSignupEmailPlaceholder();

  if (success) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(135deg, var(--bg) 0%, #1e1b4b 50%, var(--bg) 100%)', padding: 20,
      }}>
        <div style={{
          background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16,
          padding: 40, width: '100%', maxWidth: 400, textAlign: 'center',
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: '#064e3b', display: 'inline-flex',
            alignItems: 'center', justifyContent: 'center',
            fontSize: 28, marginBottom: 16,
          }}>✓</div>
          <h2 style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 700 }}>
            Pendaftaran Berhasil
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.6, margin: '0 0 20px' }}>
            Akun Anda telah dibuat dengan status <strong style={{ color: 'var(--yellow)' }}>pending</strong>.
            Admin akan mengaktifkan akun Anda. Silakan hubungi admin untuk proses approval.
          </p>
          <button
            onClick={() => router.push('/')}
            style={{
              padding: '10px 24px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg, var(--accent), #6366f1)',
              color: '#fff', fontSize: 14, fontWeight: 600,
            }}
          >
            Kembali ke Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, var(--bg) 0%, #1e1b4b 50%, var(--bg) 100%)', padding: 20,
    }}>
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16,
        padding: 40, width: '100%', maxWidth: 400,
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14,
            background: 'linear-gradient(135deg, var(--accent), #8b5cf6)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 24, fontWeight: 800, color: '#fff', marginBottom: 16,
          }}>R</div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>
            Daftar Akun
          </h1>
          <p style={{ margin: '8px 0 0', color: 'var(--dim)', fontSize: 14 }}>
            Roove BI — Internal Only
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Nama Lengkap</label>
            <input
              type="text"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              required
              placeholder="Nama lengkap"
              style={inputStyle}
              onFocus={e => e.target.style.borderColor = 'var(--accent)'}
              onBlur={e => e.target.style.borderColor = 'var(--border)'}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder={emailPlaceholder}
              style={inputStyle}
              onFocus={e => e.target.style.borderColor = 'var(--accent)'}
              onBlur={e => e.target.style.borderColor = 'var(--border)'}
            />
            <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
              {`Hanya email ${allowedDomainsLabel} yang diterima`}
            </p>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={6}
              placeholder="Minimal 6 karakter"
              style={inputStyle}
              onFocus={e => e.target.style.borderColor = 'var(--accent)'}
              onBlur={e => e.target.style.borderColor = 'var(--border)'}
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={labelStyle}>Konfirmasi Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              required
              minLength={6}
              style={inputStyle}
              onFocus={e => e.target.style.borderColor = 'var(--accent)'}
              onBlur={e => e.target.style.borderColor = 'var(--border)'}
            />
          </div>

          {error && (
            <div style={{
              padding: '10px 14px', borderRadius: 8, marginBottom: 16,
              background: '#7f1d1d', color: 'var(--red)', fontSize: 13,
            }}>{error}</div>
          )}

          <button type="submit" disabled={loading} style={{
            width: '100%', padding: '12px 16px', borderRadius: 10,
            border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: 14, fontWeight: 700, letterSpacing: '-0.01em',
            background: loading ? '#1e40af' : 'linear-gradient(135deg, var(--accent), #6366f1)',
            color: '#fff', transition: 'all 0.2s',
            opacity: loading ? 0.7 : 1,
          }}>
            {loading ? '...' : 'Daftar'}
          </button>
        </form>

        <div style={{ marginTop: 20, textAlign: 'center' }}>
          <a
            href="/"
            style={{ fontSize: 13, color: 'var(--accent)', textDecoration: 'none' }}
            onMouseEnter={e => (e.target as HTMLAnchorElement).style.color = '#60a5fa'}
            onMouseLeave={e => (e.target as HTMLAnchorElement).style.color = 'var(--accent)'}
          >
            Sudah punya akun? Masuk
          </a>
        </div>
      </div>
    </div>
  );
}
