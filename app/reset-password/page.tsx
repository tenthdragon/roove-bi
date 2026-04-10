'use client';

import { useState, useEffect } from 'react';
import { useSupabase } from '@/lib/supabase-browser';
import { useRouter, useSearchParams } from 'next/navigation';

type RecoveryLinkType = 'invite' | 'recovery';

function getRecoveryLinkType(value: string | null): RecoveryLinkType | null {
  if (value === 'invite' || value === 'recovery') return value;
  return null;
}

function clearRecoveryParamsFromUrl() {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  let changed = false;
  const queryKeys = ['code', 'token', 'token_hash', 'type', 'error', 'error_code', 'error_description'];

  queryKeys.forEach((key) => {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  });

  if (url.hash.startsWith('#')) {
    const hashParams = new URLSearchParams(url.hash.slice(1));
    const hashKeys = ['access_token', 'refresh_token', 'expires_in', 'expires_at', 'token_type', 'type'];

    hashKeys.forEach((key) => {
      if (hashParams.has(key)) {
        hashParams.delete(key);
        changed = true;
      }
    });

    url.hash = hashParams.toString() ? `#${hashParams.toString()}` : '';
  }

  if (changed) {
    window.history.replaceState(window.history.state, '', url.toString());
  }
}

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionError, setSessionError] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useSupabase();

  useEffect(() => {
    let cancelled = false;

    const queryType = getRecoveryLinkType(searchParams.get('type'));
    const queryTokenHash = searchParams.get('token_hash') || searchParams.get('token');
    const queryCode = searchParams.get('code');

    const hashParams = typeof window !== 'undefined' && window.location.hash.startsWith('#')
      ? new URLSearchParams(window.location.hash.slice(1))
      : new URLSearchParams();
    const hashType = getRecoveryLinkType(hashParams.get('type'));
    const hashAccessToken = hashParams.get('access_token');
    const hashRefreshToken = hashParams.get('refresh_token');
    const recoveryType = queryType || hashType;

    const markReady = () => {
      if (cancelled) return;
      clearRecoveryParamsFromUrl();
      setError('');
      setSessionError(false);
      setSessionReady(true);
    };

    const markInvalid = (message?: string) => {
      if (cancelled) return;
      setSessionReady(false);
      setSessionError(true);
      if (message) setError(message);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) return;

      if (
        event === 'PASSWORD_RECOVERY' ||
        ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && (recoveryType === 'invite' || recoveryType === 'recovery'))
      ) {
        markReady();
      }
    });

    const init = async () => {
      try {
        if (queryCode) {
          const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(queryCode);
          if (exchangeError) throw exchangeError;
          if (data.session) {
            markReady();
            return;
          }
        }

        if (queryTokenHash && recoveryType) {
          const { data, error: verifyError } = await supabase.auth.verifyOtp({
            token_hash: queryTokenHash,
            type: recoveryType,
          });
          if (verifyError) throw verifyError;
          if (data.session) {
            markReady();
            return;
          }
        }

        if (hashAccessToken && hashRefreshToken) {
          const { data, error: setSessionError } = await supabase.auth.setSession({
            access_token: hashAccessToken,
            refresh_token: hashRefreshToken,
          });
          if (setSessionError) throw setSessionError;
          if (data.session) {
            markReady();
            return;
          }
        }

        const { data: { session }, error: getSessionError } = await supabase.auth.getSession();
        if (getSessionError) throw getSessionError;
        if (session) {
          markReady();
          return;
        }

        markInvalid();
      } catch (err: any) {
        console.error('[ResetPasswordPage] Failed to validate recovery link:', err);
        markInvalid(err.message || 'Link reset password tidak valid atau sudah kedaluwarsa.');
      }
    };

    init();

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [searchParams, supabase]);

  useEffect(() => {
    if (!success) return;

    const timeout = window.setTimeout(() => {
      router.push('/dashboard');
      router.refresh();
    }, 2000);

    return () => window.clearTimeout(timeout);
  }, [router, success]);

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
      background: 'linear-gradient(135deg, var(--bg) 0%, #1e1b4b 50%, var(--bg) 100%)',
      padding: 20,
    }}>
      <div style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        padding: 40,
        width: '100%',
        maxWidth: 400,
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
            Reset Password
          </h1>
          <p style={{ margin: '8px 0 0', color: 'var(--dim)', fontSize: 14 }}>
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
              background: '#7f1d1d', color: 'var(--red)', fontSize: 14,
              lineHeight: 1.5, marginBottom: 24,
            }}>
              {error || 'Link reset/set password tidak valid atau sudah kedaluwarsa. Silakan minta link baru.'}
            </div>
            <a href="/forgot-password" style={{
              display: 'block', textAlign: 'center',
              fontSize: 13, color: 'var(--accent)', textDecoration: 'none',
            }}>
              Minta link reset baru →
            </a>
          </div>
        ) : !sessionReady ? (
          <div style={{
            textAlign: 'center', color: 'var(--dim)', fontSize: 14, padding: '20px 0',
          }}>
            Memverifikasi link reset...
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 16 }}>
              <label style={{
                display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--dim)',
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
                  border: '1px solid var(--border)', background: 'var(--bg)',
                  color: 'var(--text)', fontSize: 16, outline: 'none',
                }}
                onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{
                display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--dim)',
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
                  border: '1px solid var(--border)', background: 'var(--bg)',
                  color: 'var(--text)', fontSize: 16, outline: 'none',
                }}
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
              {loading ? '...' : 'Simpan Password Baru'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
