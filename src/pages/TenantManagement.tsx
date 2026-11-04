import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  Search, 
  Power, 
  PowerOff,
  UserCheck, 
  ShieldAlert,
  Loader2,
  Calendar,
  Globe,
  X,
  AlertTriangle,
  KeyRound
} from 'lucide-react';

interface Tenant {
  tenant_id: number;
  subdomain: string;
  created_at: string;
  status: 'active' | 'suspended';
  admin_id: number | null;
  admin_name: string;
  admin_email: string;
}

interface ModalConfig {
  isOpen: boolean;
  type: 'impersonate' | 'suspend' | 'activate' | 'reset_password' | null;
  tenant: Tenant | null;
}

export function TenantManagement() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [modal, setModal] = useState<ModalConfig>({ isOpen: false, type: null, tenant: null });
  const [passwords, setPasswords] = useState({ newPassword: '', confirmPassword: '' });
  const [resetError, setResetError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    fetchTenants();
  }, []);

  // Close modal on Escape key
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modal.isOpen && actionLoading === null) {
        closeModal();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [modal.isOpen, actionLoading]);

  const fetchTenants = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get(`${import.meta.env.VITE_API_URL}/api/v1/superadmin/tenants`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setTenants(res.data);
    } catch (err) {
      console.error('Failed to fetch tenants:', err);
    } finally {
      setLoading(false);
    }
  };

  const openSuspendModal = (tenant: Tenant) => {
    const type = tenant.status === 'active' ? 'suspend' : 'activate';
    setModal({ isOpen: true, type, tenant });
  };

  const openImpersonateModal = (tenant: Tenant) => {
    setModal({ isOpen: true, type: 'impersonate', tenant });
  };

  const openResetPasswordModal = (tenant: Tenant) => {
    setPasswords({ newPassword: '', confirmPassword: '' });
    setResetError('');
    setNotice('');
    setModal({ isOpen: true, type: 'reset_password', tenant });
  };

  const closeModal = () => {
    setModal({ isOpen: false, type: null, tenant: null });
    setPasswords({ newPassword: '', confirmPassword: '' });
    setResetError('');
  };

  const handleConfirmAction = async () => {
    if (!modal.tenant || !modal.type) return;

    if (modal.type === 'impersonate') {
      await executeImpersonate(modal.tenant.tenant_id, modal.tenant.subdomain);
    } else if (modal.type === 'reset_password') {
      await executeResetPassword(modal.tenant);
      return;
    } else {
      await executeToggleStatus(modal.tenant.tenant_id, modal.tenant.status);
    }
    closeModal();
  };

  const executeResetPassword = async (tenant: Tenant) => {
    if (!tenant.admin_id) return;
    if (passwords.newPassword.length < 12 || passwords.newPassword.length > 128 || !passwords.newPassword.trim()) {
      setResetError('Password baru harus berisi 12–128 karakter.');
      return;
    }
    if (passwords.newPassword !== passwords.confirmPassword) {
      setResetError('Konfirmasi password tidak cocok.');
      return;
    }
    setResetError('');
    setActionLoading(tenant.tenant_id);
    try {
      const token = localStorage.getItem('token');
      await axios.put(`${import.meta.env.VITE_API_URL}/api/v1/superadmin/tenants/${tenant.tenant_id}/admins/${tenant.admin_id}/password`, passwords, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setNotice(`Password admin ${tenant.admin_email} berhasil direset.`);
      closeModal();
    } catch (err: any) {
      setResetError(err.response?.data?.error || 'Gagal mereset password. Silakan coba lagi.');
    } finally {
      setActionLoading(null);
    }
  };

  const executeToggleStatus = async (tenantId: number, currentStatus: string) => {
    const newStatus = currentStatus === 'active' ? 'suspended' : 'active';

    setActionLoading(tenantId);
    try {
      const token = localStorage.getItem('token');
      await axios.patch(`${import.meta.env.VITE_API_URL}/api/v1/superadmin/tenants/${tenantId}/status`, 
        { status: newStatus },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      setTenants(prev => prev.map(t => t.tenant_id === tenantId ? { ...t, status: newStatus } : t));
    } catch (err) {
      console.error('Failed to update tenant status:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const executeImpersonate = async (tenantId: number, subdomain: string) => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.post(`${import.meta.env.VITE_API_URL}/api/v1/superadmin/impersonate/${tenantId}`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      const { tenant_id, site_name, subdomain: tenantSubdomain, admin_name } = res.data;
      
      // Shadow Mode: Keep own JWT, just switch tenant context
      localStorage.setItem('active_tenant_id', String(tenant_id));
      localStorage.setItem('active_role', 'admin');
      
      // Store impersonation metadata for the UI bar
      localStorage.setItem('impersonating_tenant', JSON.stringify({
        tenant_id,
        subdomain: tenantSubdomain,
        site_name,
        admin_name
      }));
      
      // Hard redirect to tenant dashboard
      window.location.replace('/dashboard');
    } catch (err) {
      console.error('Failed to impersonate:', err);
    }
  };

  const filteredTenants = tenants.filter(t => 
    t.subdomain?.toLowerCase().includes(searchTerm.toLowerCase()) || 
    t.admin_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.admin_email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="mt-4 text-zinc-500 font-bold uppercase tracking-widest text-xs">Memuat Data Tenant...</p>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in duration-500 space-y-8 max-w-7xl mx-auto">
      
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
           <h2 className="text-3xl font-black text-white tracking-tight">Manajemen Tenant</h2>
           <p className="text-zinc-400 text-sm font-medium mt-1">Kelola status operasional dan sesi semua startup yang terdaftar.</p>
           {notice && <p role="status" className="text-emerald-400 text-sm mt-2">{notice}</p>}
        </div>
        
        <div className="relative group w-full md:w-80">
          <input 
            type="text"
            placeholder="Cari subdomain atau nama admin..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-5 py-3 pl-12 bg-zinc-900 border border-zinc-800 text-white rounded-xl placeholder-zinc-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all font-medium text-sm"
          />
          <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-amber-500 transition-colors" />
        </div>
      </div>

      <div className="bg-zinc-900/50 backdrop-blur-md rounded-xl border border-slate-800 shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-900 border-b border-zinc-800 text-zinc-400 text-[10px] uppercase tracking-widest">
                <th className="px-8 py-5 font-black">Tenant & Subdomain</th>
                <th className="px-8 py-5 font-black">Admin Akun</th>
                <th className="px-8 py-5 font-black">Terdaftar Sejak</th>
                <th className="px-8 py-5 font-black">Status</th>
                <th className="px-8 py-5 font-black text-right">Aksi Super Admin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50 text-sm text-zinc-300">
              {filteredTenants.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-8 py-12 text-center text-zinc-500 font-medium">
                    Tidak ada tenant yang ditemukan.
                  </td>
                </tr>
              ) : (
                filteredTenants.map((tenant) => (
                  <tr key={tenant.tenant_id} className="hover:bg-zinc-800/20 transition-colors group">
                    <td className="px-8 py-6">
                       <div className="flex items-center gap-3">
                          <div className="p-2.5 bg-amber-500/10 rounded-xl">
                             <Globe className="w-5 h-5 text-amber-500" />
                          </div>
                          <div>
                             <p className="font-bold text-white mb-0.5">{tenant.subdomain}</p>
                             <p className="text-xs text-zinc-500 font-mono flex items-center gap-1">
                                {tenant.subdomain}.uni-verse.id
                             </p>
                          </div>
                       </div>
                    </td>
                    <td className="px-8 py-6">
                       <p className="font-bold text-white mb-0.5">{tenant.admin_name || 'Tidak ada Admin'}</p>
                       <p className="text-xs text-zinc-500">{tenant.admin_email || '-'}</p>
                    </td>
                    <td className="px-8 py-6">
                       <div className="flex items-center gap-2 text-zinc-400">
                         <Calendar className="w-4 h-4" />
                         <span>{new Date(tenant.created_at).toLocaleDateString('id-ID', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                       </div>
                    </td>
                    <td className="px-8 py-6">
                       <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border ${
                         tenant.status === 'active' 
                           ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' 
                           : 'bg-red-500/10 text-red-400 border-red-500/20'
                       }`}>
                         {tenant.status === 'active' ? (
                           <>
                             <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Aktif
                           </>
                         ) : (
                           <>
                             <div className="w-1.5 h-1.5 rounded-full bg-red-500" /> Ditangguhkan
                           </>
                         )}
                       </div>
                    </td>
                    <td className="px-8 py-6">
                       <div className="flex items-center justify-end gap-3 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                          <button
                              onClick={() => openImpersonateModal(tenant)}
                              className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-cyan-500 text-zinc-300 hover:text-black rounded-xl transition-all text-xs font-bold"
                              title="Impersonate (Masuk sebagai Shadow Owner)"
                            >
                              <UserCheck className="w-4 h-4" />
                              <span className="hidden lg:inline">Impersonate</span>
                            </button>
                          <button
                            onClick={() => openResetPasswordModal(tenant)}
                            disabled={!tenant.admin_id || actionLoading === tenant.tenant_id}
                            className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-amber-500 text-zinc-300 hover:text-black rounded-xl transition-all text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                            title={tenant.admin_id ? 'Reset password darurat admin tenant' : 'Tenant belum memiliki admin'}
                          >
                            <KeyRound className="w-4 h-4" />
                            <span className="hidden lg:inline">Reset Password</span>
                          </button>
                         
                         <button
                           onClick={() => openSuspendModal(tenant)}
                           disabled={actionLoading === tenant.tenant_id}
                           className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all text-xs font-bold disabled:opacity-50 ${
                             tenant.status === 'active' 
                               ? 'bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white' 
                               : 'bg-amber-500/10 hover:bg-amber-500 text-amber-500 hover:text-white'
                           }`}
                         >
                           {actionLoading === tenant.tenant_id ? (
                             <Loader2 className="w-4 h-4 animate-spin" />
                           ) : tenant.status === 'active' ? (
                             <>
                               <PowerOff className="w-4 h-4" />
                               <span className="hidden lg:inline">Suspend</span>
                             </>
                           ) : (
                             <>
                               <Power className="w-4 h-4" />
                               <span className="hidden lg:inline">Aktivasi</span>
                             </>
                           )}
                         </button>
                       </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Custom Confirmation Modal */}
      {modal.isOpen && modal.tenant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => actionLoading === null && closeModal()} />
          <div className="relative bg-[#09090b] border border-zinc-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            
            {/* Modal Header */}
            <div className={`px-8 pt-8 pb-4 flex items-start gap-4`}>
              <div className={`p-3 rounded-xl flex-shrink-0 ${
                modal.type === 'impersonate' 
                  ? 'bg-cyan-500/10' 
                  : modal.type === 'suspend' ? 'bg-red-500/10' : 'bg-amber-500/10'
              }`}>
                {modal.type === 'impersonate' ? (
                  <UserCheck className="w-6 h-6 text-cyan-400" />
                ) : modal.type === 'suspend' ? (
                  <AlertTriangle className="w-6 h-6 text-red-400" />
                ) : modal.type === 'reset_password' ? (
                  <KeyRound className="w-6 h-6 text-amber-400" />
                ) : (
                  <Power className="w-6 h-6 text-amber-400" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-black text-white mb-1">
                  {modal.type === 'impersonate' && 'Impersonate Tenant'}
                  {modal.type === 'suspend' && 'Suspend Tenant'}
                  {modal.type === 'activate' && 'Aktivasi Tenant'}
                  {modal.type === 'reset_password' && 'Reset Password Darurat'}
                </h3>
                <p className="text-sm text-zinc-400 leading-relaxed">
                  {modal.type === 'impersonate' && (
                    <>Masuk sebagai <span className="font-bold text-cyan-400">{modal.tenant.subdomain}</span>? Anda akan dialihkan ke dashboard mereka.</>
                  )}
                  {modal.type === 'suspend' && (
                    <>Peringatan: Suspend <span className="font-bold text-red-400">{modal.tenant.subdomain}</span>? Akses admin mereka akan segera dibatasi.</>
                  )}
                  {modal.type === 'activate' && (
                    <>Aktifkan kembali <span className="font-bold text-amber-400">{modal.tenant.subdomain}</span>? Akses admin mereka akan dipulihkan.</>
                  )}
                  {modal.type === 'reset_password' && (
                    <>Password akun admin akan langsung diganti. Jika akun ini memiliki akses ke tenant lain, password barunya berlaku di sana juga.</>
                  )}
                </p>
              </div>
              <button 
                onClick={closeModal}
                disabled={actionLoading !== null}
                className="p-1.5 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Tenant Info Card */}
            <div className="mx-8 mb-6 p-4 bg-zinc-900/80 rounded-xl border border-zinc-800">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-500/10 rounded-lg">
                  <Globe className="w-4 h-4 text-amber-500" />
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-white text-sm truncate">{modal.tenant.subdomain}</p>
                  <p className="text-xs text-zinc-500">{modal.tenant.admin_name || 'N/A'} — {modal.tenant.admin_email || 'N/A'}</p>
                </div>
              </div>
            </div>

            {modal.type === 'reset_password' && (
              <div className="px-8 pb-6 space-y-4">
                <label className="block text-sm font-bold text-zinc-300">
                  Password baru
                  <input type="password" autoComplete="new-password" minLength={12} maxLength={128}
                    value={passwords.newPassword}
                    onChange={e => setPasswords(prev => ({ ...prev, newPassword: e.target.value }))}
                    className="mt-2 w-full px-4 py-3 bg-zinc-900 border border-zinc-700 text-white rounded-xl focus:outline-none focus:border-amber-500"
                    placeholder="Minimal 12 karakter" />
                </label>
                <label className="block text-sm font-bold text-zinc-300">
                  Konfirmasi password baru
                  <input type="password" autoComplete="new-password" minLength={12} maxLength={128}
                    value={passwords.confirmPassword}
                    onChange={e => setPasswords(prev => ({ ...prev, confirmPassword: e.target.value }))}
                    className="mt-2 w-full px-4 py-3 bg-zinc-900 border border-zinc-700 text-white rounded-xl focus:outline-none focus:border-amber-500"
                    placeholder="Ketik ulang password baru" />
                </label>
                {resetError && <p role="alert" className="text-sm text-red-400">{resetError}</p>}
              </div>
            )}

            {/* Modal Actions */}
            <div className="px-8 py-5 border-t border-zinc-800 flex items-center justify-end gap-3 bg-zinc-900/30">
              <button 
                onClick={closeModal}
                disabled={actionLoading !== null}
                className="px-5 py-2.5 text-zinc-400 hover:text-white font-bold text-sm transition-colors rounded-xl hover:bg-zinc-800"
              >
                Batal
              </button>
              <button 
                onClick={handleConfirmAction}
                disabled={actionLoading !== null}
                className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-black text-sm transition-all active:scale-95 ${
                  modal.type === 'impersonate' 
                    ? 'bg-cyan-500 hover:bg-cyan-400 text-black shadow-lg shadow-cyan-500/20' 
                    : modal.type === 'suspend' 
                      ? 'bg-red-500 hover:bg-red-400 text-white shadow-lg shadow-red-500/20' 
                      : 'bg-amber-500 hover:bg-amber-400 text-black shadow-lg shadow-amber-500/20'
                }`}
              >
                {modal.type === 'impersonate' && (
                  <><UserCheck className="w-4 h-4" /> Lanjutkan</>
                )}
                {modal.type === 'suspend' && (
                  <><PowerOff className="w-4 h-4" /> Suspend</>
                )}
                {modal.type === 'activate' && (
                  <><Power className="w-4 h-4" /> Aktivasi</>
                )}
                {modal.type === 'reset_password' && (
                  actionLoading === modal.tenant.tenant_id ? <><Loader2 className="w-4 h-4 animate-spin" /> Mereset...</> : <><KeyRound className="w-4 h-4" /> Reset Password</>
                )}
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
