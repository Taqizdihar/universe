import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Layout as LayoutIcon, Mail, Lock, AlertCircle, ArrowRight } from 'lucide-react';
import axios from 'axios';
import universeLogo from '../assets/logo/UNI-VERSE Logo V3.png';
import { useCMS } from '../context/CMSContext';

export function Login() {
  const navigate = useNavigate();
  const { setToken, setUser, setActiveTenantId, setActiveRole } = useCMS();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Auto-redirect if already logged in
  useEffect(() => {

    if (localStorage.getItem('token')) {
       const user = JSON.parse(localStorage.getItem('user') || '{}');
       const hasActiveTenant = !!localStorage.getItem('active_tenant_id');
       
        // Super Admin Check
        if (user.role === 'super_admin') {
          navigate('/super-admin/dashboard');
          return;
        }

        // If an active_tenant_id is set (from workspace switch), always go to dashboard
        // This prevents the login loop where switching workspaces triggers /setup
        if (hasActiveTenant) {
          navigate('/dashboard');
        } else if (user.site_name && user.site_name !== 'My Site') {
          navigate('/dashboard');
        } else {
          navigate('/setup');
        }
    }
  }, [navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const cleanEmail = email.trim().toLowerCase();
      console.log(`[FRONTEND] Attempting login for ${cleanEmail}`);
      const res = await axios.post(`${import.meta.env.VITE_API_URL}/api/auth/login`, { email: cleanEmail, password });
      
      const { token, user } = res.data;
      
      // Task 2: Clear ALL old session data before setting new values
      localStorage.clear();
      
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
      
      const primaryTenantId = String(res.data.primary_tenant_id || user.primary_tenant_id || user.tenant_id || '');

      // Always set active workspace from login response (primary tenant)
      localStorage.setItem('active_tenant_id', primaryTenantId);
      localStorage.setItem('active_role', user.role || 'admin');
      
      // Store primary tenant ID for TIM MITRA badge logic
      localStorage.setItem('primary_tenant_id', primaryTenantId);
      
      setToken(token);
      setUser(user);
      setActiveTenantId(parseInt(primaryTenantId, 10));
      setActiveRole(user.role || 'admin');
      
      console.log(`[FRONTEND] Login success. User ID: ${user.id}`);

      // Super Admin Check
      if (user.role === 'super_admin') {
        navigate('/super-admin/dashboard');
      } else if (user.site_name && user.site_name !== 'My Site') {
         navigate('/dashboard');
      } else {
         navigate('/setup');
      }
    } catch (err: any) {
      console.error('[FRONTEND ERROR] Login failed:', err);
      setError(err.response?.data?.error || 'Otorisasi gagal. Silakan periksa kredensial Anda.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#09090b] flex flex-col justify-center items-center py-12 px-6 lg:px-8 font-sans">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <Link to="/" className="mb-8 block group">
          <img src={universeLogo} alt="UNI-VERSE" className="h-12 w-auto mx-auto group-hover:scale-105 transition-transform" />
        </Link>
        <h2 className="text-3xl font-black text-white tracking-tight">Portal Admin</h2>
        <p className="mt-2 text-sm text-gray-500 font-medium tracking-wide">Masuk ke konsol untuk mengelola website Anda.</p>
      </div>

      <div className="mt-10 sm:mx-auto sm:w-full sm:max-w-[440px]">
        <div className="bg-zinc-900/50 backdrop-blur-xl py-10 px-8 border border-zinc-800 rounded-xl shadow-2xl">
          <form className="space-y-6" onSubmit={handleLogin}>
            {error && (
              <div className="bg-red-500/10 border border-red-500/50 text-red-400 text-xs font-bold p-4 rounded-xl flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                {error}
              </div>
            )}

            <div>
              <label className="block text-xs font-black text-zinc-500 uppercase tracking-widest ml-1 mb-2">Email</label>
              <div className="relative group">
                <input 
                  required 
                  type="email" 
                  value={email} 
                  onChange={e => setEmail(e.target.value)} 
                  className="appearance-none block w-full px-5 py-4 bg-zinc-950 border border-zinc-800 text-white rounded-xl placeholder-zinc-700 focus:outline-none focus:ring-2 focus:ring-amber-400/20 focus:border-amber-400 transition-all font-medium pl-12" 
                  placeholder="admin@uniinside.com"
                />
                <Mail className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600 group-focus-within:text-amber-400 transition-colors" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-black text-zinc-500 uppercase tracking-widest ml-1 mb-2">Kata Sandi</label>
              <div className="relative group">
                <input 
                  required 
                  type="password" 
                  value={password} 
                  onChange={e => setPassword(e.target.value)} 
                  className="appearance-none block w-full px-5 py-4 bg-zinc-950 border border-zinc-800 text-white rounded-xl placeholder-zinc-700 focus:outline-none focus:ring-2 focus:ring-amber-400/20 focus:border-amber-400 transition-all font-medium pl-12" 
                  placeholder="••••••••"
                />
                <Lock className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600 group-focus-within:text-amber-400 transition-colors" />
              </div>
              <div className="mt-2 text-right"><Link to="/forgot-password" className="text-sm font-semibold text-amber-400 hover:text-amber-300">Lupa kata sandi?</Link></div>
            </div>

            <div>
              <button 
                disabled={loading}
                type="submit" 
                className="group w-full flex justify-center items-center gap-2 py-4 px-4 bg-amber-400 text-black text-sm font-black rounded-xl hover:bg-amber-300 transition-all shadow-xl shadow-amber-400/10 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Memproses...' : 'Masuk ke Konsol'}
                {!loading && <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />}
              </button>
            </div>
          </form>

          <div className="mt-8 pt-8 border-t border-zinc-800 text-center text-sm">
            <span className="text-zinc-500 font-medium">Administrator baru? </span>
            <Link to="/register" className="font-bold text-amber-400 hover:text-amber-300 transition-all underline decoration-zinc-800 underline-offset-4">Buat akun</Link>
          </div>
        </div>

        <div className="mt-8 flex justify-center gap-6 text-xs font-black text-zinc-600 uppercase tracking-widest">
            <span className="flex items-center gap-2 grayscale brightness-50"><div className="w-2 h-2 rounded-full bg-green-500" /> AES-256</span>
            <span className="flex items-center gap-2 grayscale brightness-50"><div className="w-2 h-2 rounded-full bg-green-500" /> JWT</span>
        </div>
      </div>
    </div>
  );
}
