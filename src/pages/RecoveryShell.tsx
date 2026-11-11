import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import universeLogo from '../assets/logo/UNI-VERSE Logo V3.png';

export function RecoveryShell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <main className="min-h-screen bg-[#09090b] flex flex-col justify-center items-center py-12 px-6 font-sans">
    <div className="w-full max-w-[440px] text-center">
      <Link to="/" className="mb-8 block"><img src={universeLogo} alt="UNI-VERSE" className="h-12 w-auto mx-auto" /></Link>
      <h1 className="text-3xl font-black text-white tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-zinc-400">{description}</p>
      <div className="mt-10 bg-zinc-900/50 backdrop-blur-xl p-8 sm:p-10 border border-zinc-800 rounded-xl shadow-2xl text-left">{children}</div>
      <Link to="/login" className="inline-block mt-7 text-sm font-semibold text-amber-400 hover:text-amber-300">Kembali ke halaman masuk</Link>
    </div>
  </main>;
}

export const recoveryInput = 'block w-full px-5 py-4 bg-zinc-950 border border-zinc-800 text-white rounded-xl placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-400/20 focus:border-amber-400';
export const recoveryButton = 'w-full py-4 px-4 bg-amber-400 text-black text-sm font-black rounded-xl hover:bg-amber-300 disabled:opacity-50 disabled:cursor-not-allowed';
export const recoveryLabel = 'block text-xs font-black text-zinc-400 uppercase tracking-widest mb-2';
