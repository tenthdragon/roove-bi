'use client';

import { useState, useEffect } from 'react';
import { useSupabase } from '@/lib/supabase-browser';
import { useRouter } from 'next/navigation';

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionError, setSessionError] = useState(false);
  const router = useRouter();
  const supabase = useSupabase();

  // Supabase will automatically exchange the token from the URL hash
  // when the page loads. We listen for the auth state change.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event) => {
        if (event === 'PASSWORD_RECOVERY') {
          setSessionReady(true);
        }
      }
    );

    // Also check if user already has a session (e.g. page reload)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setSessionReady(true);
      }
    });

    // Timeout: if no session after 5 seconds, show error
    const timeout = setTimeout(() => {
      setSessionReady(prev => {
        if (!prev) setSessionError(true);
        return prev;
      });
    }, 5000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [supabase]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('Password minimal 6 karakter');
      return;
    }

    if (password !== confirmPassword) {
      setError('Password dan konfirmasi tidak cocok');
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setSuccess(true);

      // Redirect to dashboard after 2 seconds
      setTimeout(() => {
        router.push('/dashboard');
        router.refresh();
      }, 2000);
    } catch (err: any) {
      setError(err.message || 'Gagal mengubah password');
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
            Reset Password
          </h1>
          <p style={{ margin: '8px 0 0', color: '#64748b', fontSize: 14 }}>
            Masukkan password baru Anda
          </p>
        </div>

        {success ? (
          <div>
            <div style={{
              padding: '14px 16px', borderRadius: 8,
              background: '#052e16', color: '#4ade80', fontSize: 14,
              lineHeight: 1.5, marginBottom: 24,
            }}>
              Password berhasil diubah! Anda akan diarahkan ke dashboard...
            </div>
          </div>
        ) : sessionError ? (
          <div>
            <div style={{
              padding: '14px 16px', borderRadius: 8,
              background: '#7f1d1d', color: '#ef4444', fontSize: 14,
              lineHeight: 1.5, marginBottom: 24,
            }}>
              Link reset password tidak valid atau sudah kedaluwarsa. Silakan minta link baru.
            </div>
            <a href="/forgot-password" style={{
              display: 'block', textAlign: 'center',
              fontSize: 13, color: '#3b82f6', textDecoration: 'none',
            }}>
              Minta link reset baru →
            </a>
          </div>
        ) : !sessionReady ? (
          <div style={{
            textAlign: 'center', color: '#64748b', fontSize: 14, padding: '20px 0',
          }}>
            Memverifikasi link reset...
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 16 }}>
              <label style={{
                display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b',
                marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em',
              }}>
                Password Baru
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={6}
                placeholder="Minimal 6 karakter"
                style={{
                  width: '100%', padding: '10px 14px', borderRadius: 8,
                  border: '1px solid #1a2744', background: '#0b1121',
                  color: '#e2e8f0', fontSize: 16, outline: 'none',
                }}
                onFocus={e => e.target.style.borderColor = '#3b82f6'}
                onBlur={e => e.target.style.borderColor = '#1a2744'}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{
                display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b',
                marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em',
              }}>
                Konfirmasi Password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                placeholder="Ulangi password baru"
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
              {loading ? '...' : 'Simpan Password Baru'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
