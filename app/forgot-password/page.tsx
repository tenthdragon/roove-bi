'use client';

import { useState } from 'react';
import { useSupabase } from '@/lib/supabase-browser';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const supabase = useSupabase();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setSent(true);
    } catch (err: any) {
      setError(err.message || 'Gagal mengirim email reset password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #0b1121 0%, #1e1b4b 50%, #0b1121 100%)',
      padding: 20,
    }}>
      <div style={{
        background: '#111a2e',
        border: '1px solid #1a2744',
        borderRadius: 16,
        padding: 40,
        width: '100%',
        maxWidth: 400,
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14,
            background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 24, fontWeight: 800, color: '#fff', marginBottom: 16,
          }}>R</div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>
            Lupa Password
          </h1>
          <p style={{ margin: '8px 0 0', color: '#64748b', fontSize: 14 }}>
            Masukkan email untuk menerima link reset password
          </p>
        </div>

        {sent ? (
          <div>
            <div style={{
              padding: '14px 16px', borderRadius: 8,
              background: '#052e16', color: '#4ade80', fontSize: 14,
              lineHeight: 1.5, marginBottom: 24,
            }}>
              Link reset password telah dikirim ke <strong>{email}</strong>. Silakan cek inbox atau folder spam Anda.
            </div>
            <a href="/" style={{
              display: 'block', textAlign: 'center',
              fontSize: 13, color: '#3b82f6', textDecoration: 'none',
            }}>
              ← Kembali ke halaman login
            </a>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 24 }}>
              <label style={{
                display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b',
                marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em',
              }}>
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder="nama@email.com"
                style={{
                  width: '100%', padding: '10px 14px', borderRadius: 8,
                  border: '1px solid #1a2744', background: '#0b1121',
                  color: '#e2e8f0', fontSize: 16, outline: 'none',
                }}
                onFocus={e => e.target.style.borderColor = '#3b82f6'}
                onBlur={e => e.target.style.borderColor = '#1a2744'}
              />
            </div>

            {error && (
              <div style={{
                padding: '10px 14px', borderRadius: 8, marginBottom: 16,
                background: '#7f1d1d', color: '#ef4444', fontSize: 13,
              }}>{error}</div>
            )}

            <button type="submit" disabled={loading} style={{
              width: '100%', padding: '12px 16px', borderRadius: 10,
              border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: 14, fontWeight: 700, letterSpacing: '-0.01em',
              background: loading ? '#1e40af' : 'linear-gradient(135deg, #3b82f6, #6366f1)',
              color: '#fff', transition: 'all 0.2s',
              opacity: loading ? 0.7 : 1,
            }}>
              {loading ? '...' : 'Kirim Link Reset'}
            </button>

            <div style={{ marginTop: 16, textAlign: 'center' }}>
              <a href="/" style={{
                fontSize: 13, color: '#3b82f6', textDecoration: 'none',
              }}>
                ← Kembali ke halaman login
              </a>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
