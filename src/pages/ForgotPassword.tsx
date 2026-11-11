import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { RecoveryShell, recoveryButton, recoveryInput, recoveryLabel } from './RecoveryShell';

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(''); setBusy(true);
    try {
      await axios.post(`${import.meta.env.VITE_API_URL}/api/auth/forgot-password`, { email: email.trim().toLowerCase() });
      setSent(true);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Permintaan belum dapat diproses. Coba lagi nanti.');
    } finally { setBusy(false); }
  };
  return <RecoveryShell title="Lupa kata sandi?" description="Pulihkan akses akun UNI-VERSE melalui email.">
    {sent ? <div role="status" className="text-sm text-zinc-200 leading-relaxed">Jika email tersebut terdaftar, kami akan mengirimkan tautan pemulihan kata sandi. Periksa kotak masuk dan folder spam. Tautan berlaku 30 menit.</div>
      : <form onSubmit={submit} className="space-y-6">
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        <div><label htmlFor="recovery-email" className={recoveryLabel}>Email akun</label><input id="recovery-email" className={recoveryInput} type="email" autoComplete="email" required maxLength={255} value={email} onChange={e => setEmail(e.target.value)} placeholder="nama@contoh.com" /></div>
        <button type="submit" disabled={busy} className={recoveryButton}>{busy ? 'Mengirim...' : 'Kirim Tautan Pemulihan'}</button>
      </form>}
    <div className="mt-7 pt-6 border-t border-zinc-800 text-sm text-zinc-400">Super Admin? <Link to="/super-admin/recovery" className="text-amber-400 font-semibold hover:text-amber-300">Gunakan verifikasi kode email</Link>.</div>
  </RecoveryShell>;
}
