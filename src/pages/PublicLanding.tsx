import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import universeLogo from '../assets/logo/UNI-VERSE Logo V3.png';
import uniInsideLogo from '../assets/logo/Uni-Inside Logo.png';
import Galaxy from '../components/Galaxy';

export function PublicLanding() {
  const navigate = useNavigate();
  const [version, setVersion] = useState<string>('1.0.0');

  useEffect(() => {
    if (localStorage.getItem('token')) {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      if (user.site_name && user.site_name !== 'My Site') {
        navigate('/dashboard');
      } else {
        navigate('/setup');
      }
    }
  }, [navigate]);

  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const response = await axios.get(`${import.meta.env.VITE_API_URL}/api/public/updates`);
        const latest = response.data?.[0];
        if (latest && (latest.version || latest.update_version)) {
          setVersion(latest.version || latest.update_version);
        }
      } catch (err) {
        console.error('Failed to fetch CMS version', err);
      }
    };
    fetchVersion();
  }, []);

  return (
    <div className="min-h-screen bg-[#0B0B0B] text-white flex flex-col font-sans selection:bg-amber-400 selection:text-black overflow-hidden relative">
      <div className="absolute inset-0 z-0 pointer-events-none" aria-hidden="true">
        <Galaxy
          starColors={['#FFFFFF', '#F7D15B', '#98A5FF', '#E6E6F2']}
          density={1}
          glowIntensity={0.3}
          flareIntensity={0.8}
          starSpeed={0.5}
          mouseInteraction={false}
          mouseRepulsion={false}
          clickWarp={false}
          transparent={false}
          backgroundColor="#0B0B0B"
          dpr={1.5}
        />
      </div>

      {/* Navigation */}
      <header className="flex items-center justify-between px-10 py-6 sticky top-0 z-50 bg-[#0B0B0B]/70 backdrop-blur-sm">
        <div className="flex items-center">
           <a 
            href="https://uni-inside.pages.dev/" 
            target="_blank" 
            rel="noopener noreferrer"
            className="cursor-pointer hover:opacity-80 transition-opacity"
           >
            <img src={uniInsideLogo} alt="Uni-Inside" className="h-8 w-auto object-contain" />
           </a>
        </div>
        
        <div className="absolute left-1/2 -translate-x-1/2 hidden md:block">
           <span className="text-zinc-500 font-medium text-sm tracking-wide italic">
             Uni-Inside's Content Management System
           </span>
        </div>

        <div className="flex items-center">
           <Link 
            to="/login" 
            className="px-8 py-2.5 bg-white text-black text-sm font-extrabold rounded-full hover:bg-zinc-200 transition-all active:scale-95 shadow-xl"
           >
             Masuk
           </Link>
        </div>
      </header>
      
      {/* Hero Section */}
      <main className="flex-1 flex flex-col items-center justify-center -mt-10 px-6 relative z-10">
        <div className="flex flex-col items-center text-center">
          {/* Main Logo with subtle pulse */}
          <div className="mb-8 animate-in fade-in zoom-in duration-1000">
            <img 
              src={universeLogo} 
              alt="UNI-VERSE" 
              className="w-full max-w-2xl h-auto drop-shadow-[0_0_30px_rgba(255,255,255,0.1)]" 
            />
          </div>

          <h1 
            className="text-2xl md:text-3xl font-bold tracking-tight mb-12 text-white"
            style={{ textShadow: '0 0 15px rgba(255,255,255,0.6), 0 0 30px rgba(255,255,255,0.2)' }}
          >
            Create & design within Uni-Inside's Universe
          </h1>

          <div className="flex flex-col items-center gap-6">
            <Link 
              to="/register" 
              className="px-14 py-4 bg-amber-400 text-black text-xl font-black rounded-full hover:bg-amber-300 transition-all shadow-[0_0_40px_rgba(251,191,36,0.2)] active:scale-95 hover:scale-105"
            >
               Daftar
            </Link>
            
            <span className="text-zinc-500 font-bold text-sm uppercase tracking-[0.3em] italic">
              V {version}
            </span>
          </div>
        </div>
      </main>

      <div className="absolute bottom-10 right-10 flex gap-4">
         <div className="w-1.5 h-1.5 rounded-full bg-zinc-800" />
         <div className="w-1.5 h-1.5 rounded-full bg-zinc-800" />
         <div className="w-1.5 h-1.5 rounded-full bg-zinc-800" />
      </div>
    </div>
  );
}
