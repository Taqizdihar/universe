import { useState, type FormEvent } from 'react';
import axios from 'axios';
import { RecoveryShell, recoveryButton, recoveryInput, recoveryLabel } from './RecoveryShell';

export function SuperAdminRecovery() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState<'email' | 'code' | 'done'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestCode = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    try {
      await axios.post(`${import.meta.env.VITE_API_URL}/api/auth/super-admin/request-code`, { email: email.trim().toLowerCase() });
      setStep('code');
    } catch (err: any) { setError(err.response?.data?.error || 'Kode belum dapat diminta. Coba lagi nanti.'); }
    finally { setBusy(false); }
  };
  const complete = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return;
    if (password.length < 12 || password.length > 128 || password !== confirm) { setError('Kata sandi harus berisi 12–128 karakter dan konfirmasinya cocok.'); return; }
    setBusy(true); setError('');
    try {
      await axios.post(`${import.meta.env.VITE_API_URL}/api/auth/super-admin/complete`, { email: email.trim().toLowerCase(), code, name, newPassword: password, confirmPassword: confirm });
      setCode(''); setPassword(''); setConfirm(''); setStep('done');
    } catch (err: any) { setError(err.response?.data?.error || 'Verifikasi gagal. Coba lagi.'); }
    finally { setBusy(false); }
  };
  return <RecoveryShell title="Pemulihan Super Admin" description="Verifikasi identitas melalui email Super Admin terdaftar.">
    {error && <p role="alert" className="text-sm text-red-400 mb-5">{error}</p>}
    {step === 'email' && <form className="space-y-6" onSubmit={requestCode}>
      <div><label htmlFor="sa-email" className={recoveryLabel}>Email Super Admin</label><input id="sa-email" type="email" autoComplete="email" required maxLength={255} className={recoveryInput} value={email} onChange={e => setEmail(e.target.value)} /></div>
      <button disabled={busy} className={recoveryButton}>{busy ? 'Memproses...' : 'Kirim Kode Verifikasi'}</button>
    </form>}
    {step === 'code' && <form className="space-y-6" onSubmit={complete}>
      <p className="text-sm text-zinc-300">Jika alamat tersebut memenuhi syarat, kode verifikasi telah dikirim. Kode berlaku 10 menit.</p>
      <div><label htmlFor="sa-code" className={recoveryLabel}>Kode 6 digit</label><input id="sa-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required className={recoveryInput} value={code} onChange={e => setCode(e.target.value)} /></div>
      <div><label htmlFor="sa-name" className={recoveryLabel}>Nama</label><input id="sa-name" required minLength={2} maxLength={255} className={recoveryInput} value={name} onChange={e => setName(e.target.value)} /></div>
      <div><label htmlFor="sa-password" className={recoveryLabel}>Kata sandi baru</label><input id="sa-password" type={visible ? 'text' : 'password'} autoComplete="new-password" minLength={12} maxLength={128} required className={recoveryInput} value={password} onChange={e => setPassword(e.target.value)} /></div>
      <div><label htmlFor="sa-confirm" className={recoveryLabel}>Konfirmasi kata sandi baru</label><input id="sa-confirm" type={visible ? 'text' : 'password'} autoComplete="new-password" minLength={12} maxLength={128} required className={recoveryInput} value={confirm} onChange={e => setConfirm(e.target.value)} /></div>
      <label className="flex items-center gap-2 text-sm text-zinc-300"><input type="checkbox" checked={visible} onChange={e => setVisible(e.target.checked)} />Tampilkan kata sandi</label>
      <button disabled={busy} className={recoveryButton}>{busy ? 'Memproses...' : 'Verifikasi dan Simpan'}</button>
      <button type="button" onClick={() => { setStep('email'); setError(''); }} className="block mx-auto text-sm text-amber-400">Minta kode baru</button>
    </form>}
    {step === 'done' && <p role="status" className="text-sm text-zinc-200">Kata sandi Super Admin berhasil disimpan. Silakan masuk kembali.</p>}
  </RecoveryShell>;
}
