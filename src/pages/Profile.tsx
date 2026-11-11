import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { User, Mail, Lock, Camera, Save, Key, ShieldCheck, Loader2, Building2, ChevronDown, RefreshCw } from 'lucide-react';
import { useCMS } from '../context/CMSContext';
import axios from 'axios';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/Card';
import universeLogo from '../assets/logo/UNI-VERSE Logo V3.png';

interface Workspace {
  tenant_id: number;
  tenant_name: string;
  subdomain: string;
  role: string;
  status: string;
}

export function Profile() {
  const { user, setUser, token, activeTenantId, switchWorkspace, uploadAvatar, isAvatarUploading, isSwitchingWorkspace } = useCMS();
  const [profile, setProfile] = useState({ name: '', email: '', recipient_email: '', profile_picture_url: '' });
  const [passwords, setPasswords] = useState({ current: '', new: '', confirm: '' });
  const [isSaving, setIsSaving] = useState(false);
  const [isChangingPass, setIsChangingPass] = useState(false);
  const [showPassForm, setShowPassForm] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  // Null-safe avatar URL validator — prevents <img src="null" /> 404 errors
  const getValidAvatarUrl = (url: any): string | null => {
    if (!url) return null;
    if (typeof url !== 'string') return null;
    if (url === 'null' || url === 'undefined') return null;
    if (url.startsWith('processing:')) return null;
    if (url.includes('/null') || url.endsWith('/null')) return null;
    return url;
  };

  // Workspace state
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(true);

  const headers = { 
    'Authorization': `Bearer ${token || localStorage.getItem('token')}`,
    'Content-Type': 'application/json'
  };

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const res = await axios.get(`${import.meta.env.VITE_API_URL}/api/user/profile`, { headers });
        const data = res.data;
        if (data.recipient_email === null) data.recipient_email = '';
        setProfile(data);
      } catch (err) {
        console.error('Fetch profile error:', err);
      }
    };
    fetchProfile();
  }, []);

  // Fetch workspaces
  const fetchWorkspaces = useCallback(async () => {
    setLoadingWorkspaces(true);
    try {
      const res = await axios.get(`${import.meta.env.VITE_API_URL}/api/user/workspaces`, { headers });
      setWorkspaces(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error('Fetch workspaces error:', err);
    } finally {
      setLoadingWorkspaces(false);
    }
  }, []);

  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  const handleWorkspaceSwitch = (tenantId: number) => {
    if (tenantId === activeTenantId) return;
    if (isSwitchingWorkspace) return; // Prevent overlapping switch calls
    const ws = workspaces.find(w => w.tenant_id === tenantId);
    if (ws) {
      switchWorkspace(ws.tenant_id, ws.role);
    }
  };

  const getRoleLabel = (role: string) => {
    if (!role) return '';
    return role.replace(/_/g, ' ').toUpperCase();
  };

  const handleProfileUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setMessage({ type: '', text: '' });
    try {
      await axios.put(`${import.meta.env.VITE_API_URL}/api/user/profile`, {
        name: profile.name,
        recipient_email: profile.recipient_email
      }, { headers });
      
      // Update local user context
      const updatedUser = { ...user, name: profile.name, email: profile.email };
      setUser(updatedUser);
      localStorage.setItem('user', JSON.stringify(updatedUser));
      
      setMessage({ type: 'success', text: 'Profil berhasil diperbarui!' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.response?.data?.error || 'Gagal memperbarui profil.' });
    } finally {
      setIsSaving(false);
    }
  };

  // Delegate avatar upload to global context (persists across navigation)
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadAvatar(file);
  };

  // Sync profile picture URL from global user state when CDN finishes
  useEffect(() => {
    if (user?.profile_picture_url && !isAvatarUploading) {
      const validUrl = getValidAvatarUrl(user.profile_picture_url);
      if (validUrl) {
        setProfile(prev => ({ ...prev, profile_picture_url: validUrl }));
      }
    }
  }, [user?.profile_picture_url, isAvatarUploading]);

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passwords.new !== passwords.confirm) {
      setMessage({ type: 'error', text: 'Konfirmasi kata sandi tidak cocok.' });
      return;
    }
    setIsChangingPass(true);
    try {
      await axios.put(`${import.meta.env.VITE_API_URL}/api/user/change-password`, {
        currentPassword: passwords.current,
        newPassword: passwords.new
      }, { headers });
      
      setPasswords({ current: '', new: '', confirm: '' });
      setShowPassForm(false);
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('active_tenant_id');
      localStorage.removeItem('active_role');
      localStorage.removeItem('primary_tenant_id');
      window.location.assign('/login');
    } catch (err: any) {
      setMessage({ type: 'error', text: err.response?.data?.error || 'Gagal mengubah kata sandi.' });
    } finally {
      setIsChangingPass(false);
    }
  };

  return (
    <div className="animate-in fade-in duration-500 w-full max-w-[1200px] space-y-8 pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black text-zinc-900 tracking-tight">Profil Saya</h2>
          <p className="text-zinc-500 font-medium italic mt-1">Kelola identitas digital dan keamanan akun Anda.</p>
        </div>
      </div>

      {/* Global Message Modal */}
      {message.text && createPortal(
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-zinc-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200" onClick={() => setMessage({ type: '', text: '' })}>
          <div 
            className="bg-white rounded-2xl p-6 shadow-2xl max-w-md w-full animate-in zoom-in-95 duration-200"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex flex-col items-center text-center space-y-4">
              <div className={`w-16 h-16 rounded-full flex items-center justify-center ${message.type === 'success' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                {message.type === 'success' ? <ShieldCheck className="w-8 h-8" /> : <Lock className="w-8 h-8" />}
              </div>
              <h3 className="text-xl font-black text-zinc-900">
                {message.type === 'success' ? 'Berhasil' : 'Peringatan'}
              </h3>
              <p className="text-zinc-500 font-medium">{message.text}</p>
              <button 
                onClick={() => setMessage({ type: '', text: '' })}
                className="w-full py-3 mt-2 bg-zinc-900 text-white rounded-xl font-bold hover:bg-zinc-800 transition-colors"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile Card */}
        <Card className="lg:col-span-1 border-none shadow-2xl bg-white overflow-hidden rounded-xl flex flex-col">
          <div className="h-32 bg-[#0B0B0B] relative flex items-center justify-center">
             <img src={universeLogo} alt="UNI-VERSE" className="w-64 opacity-[0.15] object-contain pointer-events-none" referrerPolicy="no-referrer" />
             <div className="absolute -bottom-16 left-1/2 -translate-x-1/2">
                <div className="relative group">
                  <div className="w-32 h-32 rounded-xl bg-zinc-100 border-4 border-white shadow-2xl flex items-center justify-center overflow-hidden">
                    {isAvatarUploading ? (
                      <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center gap-2">
                        <Loader2 className="w-8 h-8 text-white animate-spin" />
                        <span className="text-[10px] font-bold text-white/80 uppercase tracking-widest">Memproses Foto...</span>
                      </div>
                    ) : getValidAvatarUrl(profile.profile_picture_url) ? (
                      <img src={getValidAvatarUrl(profile.profile_picture_url)!} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <User className="w-12 h-12 text-zinc-300" />
                    )}
                  </div>
                  <label className="absolute bottom-0 right-0 p-2.5 bg-zinc-900 text-white rounded-xl shadow-lg cursor-pointer hover:bg-zinc-800 transition-all border-2 border-white group-hover:scale-110">
                    <Camera className="w-5 h-5" />
                    <input type="file" className="hidden" accept="image/*" onChange={handleAvatarUpload} disabled={isAvatarUploading} />
                  </label>
                </div>
             </div>
          </div>
          <CardContent className="pt-20 pb-6 text-center flex-1 flex flex-col justify-center">
            <h3 className="text-xl font-black text-zinc-900">{profile.name}</h3>
            <p className="text-zinc-500 font-medium text-sm">{profile.email}</p>
            <div className="mt-4 flex justify-center gap-2">
               <span className="px-3 py-1 bg-zinc-100 text-zinc-600 rounded-full text-[10px] font-black uppercase tracking-widest border border-zinc-200">
                 {(() => {
                   // Role-based badge: admin = ADMIN, others show their actual role
                   const currentWs = workspaces.find(w => w.tenant_id === activeTenantId);
                   const effectiveRole = currentWs?.role || user?.role || 'admin';
                   if (effectiveRole === 'admin' || effectiveRole === 'super_admin') return 'ADMIN';
                   return effectiveRole.replace(/_/g, ' ').toUpperCase();
                 })()}
               </span>
            </div>

            {/* Workspace Switcher */}
            <div className="mt-6 pt-6 border-t border-zinc-100">
              <div className="flex items-center justify-center gap-2 mb-3">
                <Building2 className="w-4 h-4 text-amber-500" />
                <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Ganti Workspace / Peran</span>
              </div>
              {loadingWorkspaces ? (
                <div className="flex items-center justify-center py-3">
                  <Loader2 className="w-4 h-4 animate-spin text-zinc-300" />
                </div>
              ) : workspaces.filter(w => w.status === 'active').length <= 1 ? (
                <p className="text-[11px] text-zinc-400 italic">Anda hanya memiliki satu workspace.</p>
              ) : (
                <div className="relative">
                  <select
                    value={activeTenantId || ''}
                    onChange={(e) => handleWorkspaceSwitch(Number(e.target.value))}
                    disabled={isSwitchingWorkspace}
                    className={`w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm font-bold text-zinc-800 focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400 transition-all appearance-none cursor-pointer pr-10 ${isSwitchingWorkspace ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {workspaces.filter(w => w.status === 'active').map(ws => (
                      <option key={ws.tenant_id} value={ws.tenant_id}>
                        {ws.tenant_name} ({getRoleLabel(ws.role)})
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 text-zinc-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Edit Form - Basic Identity */}
        <Card className="lg:col-span-2 border-none shadow-2xl bg-white rounded-xl flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="w-5 h-5 text-amber-500" /> Identitas Dasar
            </CardTitle>
            <CardDescription>Perbarui informasi publik dan kontak Anda.</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col justify-center">
            <form onSubmit={handleProfileUpdate} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-black text-zinc-400 uppercase tracking-widest ml-1">Nama Lengkap</label>
                  <div className="relative group">
                    <User className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 group-focus-within:text-amber-500 transition-colors" />
                    <input 
                      type="text" 
                      value={profile.name}
                      onChange={e => setProfile({...profile, name: e.target.value})}
                      className="w-full pl-11 pr-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none transition-all font-bold text-zinc-900" 
                      placeholder="Nama Anda"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-zinc-400 uppercase tracking-widest ml-1">Email Login</label>
                  <div className="relative group opacity-70">
                    <Mail className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" />
                    <input 
                      type="email" 
                      value={profile.email}
                      readOnly
                      disabled
                      className="w-full pl-11 pr-4 py-3 bg-zinc-100 border border-zinc-200 rounded-xl outline-none font-bold text-zinc-500 cursor-not-allowed" 
                      placeholder="email@contoh.com"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black text-zinc-400 uppercase tracking-widest ml-1">Email Penerima Pesan (Opsional)</label>
                <div className="relative group flex items-center">
                  <Mail className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 group-focus-within:text-amber-500 transition-colors" />
                  <input 
                    type="email" 
                    value={profile.recipient_email || ''}
                    onChange={e => setProfile({...profile, recipient_email: e.target.value})}
                    className="w-full pl-11 pr-24 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none transition-all font-bold text-zinc-900" 
                    placeholder="kontak@websiteanda.com"
                  />
                  {profile.recipient_email && (
                    <button
                      type="button"
                      onClick={() => setProfile({...profile, recipient_email: ''})}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      Hapus
                    </button>
                  )}
                </div>
                <p className="text-xs text-zinc-500 italic ml-1">Jika dikosongkan, semua pesan dari formulir website akan dikirim ke email login Anda.</p>
              </div>
              <div className="flex justify-end">
                <button 
                  disabled={isSaving}
                  type="submit" 
                  className="flex items-center gap-2 px-8 py-3 bg-zinc-900 text-white rounded-xl font-black text-sm hover:bg-zinc-800 transition-all shadow-lg active:scale-95 disabled:opacity-50"
                >
                  {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Simpan Perubahan
                </button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Row 2: Account Security (Full Width) */}
        <Card className="lg:col-span-3 border-none shadow-2xl bg-white overflow-hidden rounded-xl">
          <CardHeader className="flex flex-row items-center justify-between pb-6">
            <div>
              <CardTitle className="flex items-center gap-2 font-black">
                <Key className="w-5 h-5 text-zinc-400" /> Keamanan Akun
              </CardTitle>
              <CardDescription>Kelola otentikasi dan integritas data Anda.</CardDescription>
            </div>
            <button 
              onClick={() => setShowPassForm(!showPassForm)}
              className={`text-xs font-black uppercase tracking-widest underline underline-offset-4 transition-colors ${showPassForm ? 'text-red-500' : 'text-amber-500'}`}
            >
              {showPassForm ? 'Batalkan' : 'Ubah Sandi'}
            </button>
          </CardHeader>
          {showPassForm && (
            <CardContent className="pt-0 animate-in fade-in slide-in-from-top-4">
              <form onSubmit={handlePasswordChange} className="p-6 bg-zinc-50 rounded-xl border border-zinc-100 space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em] ml-1">Sandi Saat Ini</label>
                      <input 
                        required
                        type="password" 
                        value={passwords.current}
                        onChange={e => setPasswords({...passwords, current: e.target.value})}
                        className="w-full px-5 py-3 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none transition-all font-bold text-zinc-900" 
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em] ml-1">Sandi Baru</label>
                      <input 
                        required
                        type="password" 
                        value={passwords.new}
                        onChange={e => setPasswords({...passwords, new: e.target.value})}
                        className="w-full px-5 py-3 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none transition-all font-bold text-zinc-900" 
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em] ml-1">Konfirmasi Sandi</label>
                      <input 
                        required
                        type="password" 
                        value={passwords.confirm}
                        onChange={e => setPasswords({...passwords, confirm: e.target.value})}
                        className="w-full px-5 py-3 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none transition-all font-bold text-zinc-900" 
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button 
                      disabled={isChangingPass}
                      type="submit" 
                      className="flex items-center gap-2 px-8 py-3 bg-amber-400 text-zinc-950 rounded-xl font-black text-sm hover:bg-amber-300 transition-all shadow-lg active:scale-95 disabled:opacity-50"
                    >
                      {isChangingPass ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                      Konfirmasi Perubahan Sandi
                    </button>
                  </div>
              </form>
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}
