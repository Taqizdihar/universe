import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { RecoveryShell, recoveryButton, recoveryInput, recoveryLabel } from './RecoveryShell';

let capturedLink = { key: '', token: '' };
function captureResetToken() {
  // Strict Mode may invoke state initializers twice. Retain the token for this
  // history entry after stripping it from the address bar on the first call.
  const key = `${window.location.pathname}:${window.history.state?.key || 'initial'}`;
  if (capturedLink.key !== key) capturedLink = { key, token: '' };
  const value = new URLSearchParams(window.location.hash.slice(1)).get('token')
    ?? new URLSearchParams(window.location.search).get('token');
  if (value !== null) {
    capturedLink.token = /^[0-9a-f]{64}$/.test(value) ? value : '';
    window.history.replaceState(window.history.state, '', window.location.pathname);
  }
  return capturedLink.token;
}

export function ResetPassword() {
  const [token] = useState(captureResetToken);
  const [status, setStatus] = useState<'checking' | 'valid' | 'invalid' | 'done'>(token ? 'checking' : 'invalid');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!token) return;
    let active = true;
    axios.post(`${import.meta.env.VITE_API_URL}/api/auth/reset-password/validate`, { token })
      .then(res => { if (active) setStatus(res.data?.valid ? 'valid' : 'invalid'); })
      .catch(() => { if (active) { setStatus('invalid'); setError('Tautan tidak dapat diverifikasi saat ini.'); } });
    return () => { active = false; };
  }, [token]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || status !== 'valid') return;
    if (password.length < 12 || password.length > 128) { setError('Kata sandi harus berisi 12–128 karakter.'); return; }
    if (password !== confirm) { setError('Konfirmasi kata sandi tidak cocok.'); return; }
    setError(''); setBusy(true);
    try {
      await axios.post(`${import.meta.env.VITE_API_URL}/api/auth/reset-password`, { token, newPassword: password, confirmPassword: confirm });
      capturedLink.token = '';
      setPassword(''); setConfirm(''); setStatus('done');
    } catch (err: any) {
      if (err.response?.status === 400 && /tautan/i.test(err.response?.data?.error || '')) setStatus('invalid');
      setError(err.response?.data?.error || 'Gagal mengatur ulang kata sandi. Coba lagi.');
    } finally { setBusy(false); }
  };
  return <RecoveryShell title="Atur ulang kata sandi" description="Buat kata sandi baru untuk akun UNI-VERSE Anda.">
    {status === 'checking' && <p role="status" className="text-zinc-300">Memeriksa tautan pemulihan...</p>}
    {status === 'invalid' && <div role="alert" className="space-y-4"><p className="text-red-400 text-sm">{error || 'Tautan tidak valid, telah digunakan, atau kedaluwarsa.'}</p><Link to="/forgot-password" className="inline-block text-amber-400 font-semibold text-sm">Minta tautan baru</Link></div>}
    {status === 'done' && <div role="status" className="space-y-4"><p className="text-zinc-200 text-sm">Kata sandi berhasil diperbarui. Semua sesi sebelumnya telah berakhir.</p><Link to="/login" className="inline-block text-amber-400 font-semibold text-sm">Masuk dengan kata sandi baru</Link></div>}
    {status === 'valid' && <form onSubmit={submit} className="space-y-6">
      {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}
      <div><label htmlFor="new-password" className={recoveryLabel}>Kata sandi baru</label><input id="new-password" className={recoveryInput} type={visible ? 'text' : 'password'} autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={e => setPassword(e.target.value)} /></div>
      <div><label htmlFor="confirm-password" className={recoveryLabel}>Konfirmasi kata sandi</label><input id="confirm-password" className={recoveryInput} type={visible ? 'text' : 'password'} autoComplete="new-password" minLength={12} maxLength={128} required value={confirm} onChange={e => setConfirm(e.target.value)} /></div>
      <label className="flex items-center gap-2 text-sm text-zinc-300"><input type="checkbox" checked={visible} onChange={e => setVisible(e.target.checked)} />Tampilkan kata sandi</label>
      <p className="text-xs text-zinc-400">Gunakan 12–128 karakter. Pilih kata sandi yang unik dan sulit ditebak.</p>
      <button type="submit" disabled={busy} className={recoveryButton}>{busy ? 'Memproses...' : 'Simpan Kata Sandi Baru'}</button>
    </form>}
  </RecoveryShell>;
}
