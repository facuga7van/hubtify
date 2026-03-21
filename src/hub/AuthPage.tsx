import { useState } from 'react';

interface Props {
  onAuth: () => void;
}

export default function AuthPage({ onAuth }: Props) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setError('');
    setLoading(true);

    try {
      const result = isLogin
        ? await window.api.authLogin(email, password)
        : await window.api.authRegister(email, password);

      if (result.success) {
        onAuth();
      } else {
        setError(result.error ?? 'Something went wrong');
      }
    } catch (err) {
      setError('Connection error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: 'var(--rpg-parchment)',
      backgroundImage: `url(${new URL('../assets/bg.jpg', import.meta.url).href})`,
      backgroundSize: '600px', backgroundRepeat: 'repeat',
    }}>
      <div className="rpg-card" style={{ width: 360, padding: 32 }}>
        <h2 style={{ textAlign: 'center', marginBottom: 4, fontSize: '1.6rem' }}>Hubtify</h2>
        <p style={{ textAlign: 'center', opacity: 0.6, marginBottom: 24, fontSize: '0.9rem' }}>
          {isLogin ? 'Welcome back, adventurer' : 'Begin your adventure'}
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rpg-input"
            style={{ width: '100%' }}
            autoFocus
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rpg-input"
            style={{ width: '100%' }}
          />

          {error && (
            <p style={{ color: 'var(--rpg-hp-red)', fontSize: '0.85rem', margin: 0 }}>{error}</p>
          )}

          <button className="rpg-button" type="submit" disabled={loading}
            style={{ width: '100%', padding: '10px', fontSize: '0.9rem', marginTop: 4 }}>
            {loading ? 'Loading...' : isLogin ? 'Enter the Realm' : 'Create Account'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button
            onClick={() => { setIsLogin(!isLogin); setError(''); }}
            style={{
              background: 'none', border: 'none', color: 'var(--rpg-gold-dark)',
              cursor: 'pointer', fontSize: '0.85rem', textDecoration: 'underline',
            }}
          >
            {isLogin ? "Don't have an account? Register" : 'Already have an account? Login'}
          </button>
        </div>

        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <button
            onClick={onAuth}
            style={{
              background: 'none', border: 'none', color: 'var(--rpg-ink-light)',
              cursor: 'pointer', fontSize: '0.8rem', opacity: 0.5,
            }}
          >
            Continue offline
          </button>
        </div>
      </div>
    </div>
  );
}
