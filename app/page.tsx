'use client';

import { useState } from 'react';
import { useSupabase } from '@/lib/supabase-browser';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  const supabase = useSupabase();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      router.push('/dashboard');
      router.refresh();
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
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
      background: 'var(--bg)',
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
            Roove BI
          </h1>
          <p style={{ margin: '8px 0 0', color: 'var(--dim)', fontSize: 14 }}>
            Business Intelligence Dashboard
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--dim)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
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
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--dim)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={6}
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
            {loading ? '...' : 'Masuk'}
          </button>
        </form>

        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <a
            href="/forgot-password"
            style={{
              fontSize: 13, color: 'var(--accent)', textDecoration: 'none',
              transition: 'color 0.2s',
            }}
            onMouseEnter={e => (e.target as HTMLAnchorElement).style.color = '#60a5fa'}
            onMouseLeave={e => (e.target as HTMLAnchorElement).style.color = 'var(--accent)'}
          >
            Lupa password?
          </a>
        </div>

        <div style={{ marginTop: 12, textAlign: 'center' }}>
          <a
            href="/register"
            style={{ fontSize: 13, color: 'var(--dim)', textDecoration: 'none' }}
            onMouseEnter={e => (e.target as HTMLAnchorElement).style.color = 'var(--text-secondary)'}
            onMouseLeave={e => (e.target as HTMLAnchorElement).style.color = 'var(--dim)'}
          >
            Belum punya akun? Daftar
          </a>
        </div>
      </div>
    </div>
  );
}
