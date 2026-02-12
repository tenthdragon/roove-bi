'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const router = useRouter();
  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
      }
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
            Roove BI
          </h1>
          <p style={{ margin: '8px 0 0', color: '#64748b', fontSize: 14 }}>
            Business Intelligence Dashboard
          </p>
        </div>

        {/* Toggle */}
        <div style={{
          display: 'flex', gap: 2, background: '#0b1121', borderRadius: 10, padding: 3,
          marginBottom: 24, border: '1px solid #1a2744',
        }}>
          {(['login', 'signup'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              flex: 1, padding: '8px 16px', borderRadius: 8, border: 'none',
              cursor: 'pointer', fontSize: 13, fontWeight: 600,
              background: mode === m ? '#3b82f6' : 'transparent',
              color: mode === m ? '#fff' : '#64748b',
              transition: 'all 0.2s',
            }}>
              {m === 'login' ? 'Masuk' : 'Daftar'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
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
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
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
            {loading ? '...' : mode === 'login' ? 'Masuk' : 'Daftar Akun Baru'}
          </button>
        </form>

        {mode === 'signup' && (
          <p style={{ marginTop: 16, fontSize: 12, color: '#64748b', textAlign: 'center' }}>
            Akun pertama yang didaftarkan otomatis menjadi Owner.
          </p>
        )}
      </div>
    </div>
  );
}
