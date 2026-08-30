import '../styles/globals.css';
import Head from 'next/head';
import { AuthProvider } from '../src/lib/auth';
import { ThemeProvider } from '../src/lib/theme';
import InstallAppPrompt from '../src/components/InstallAppPrompt';
import RoleRouteGuard from '../src/components/RoleRouteGuard';
import { ToastProvider } from '../src/components/ToastProvider';
import Router from 'next/router';
import { useEffect, useState } from 'react';

export default function App(props: any) {
  const { Component, pageProps } = props;
  const [navigating, setNavigating] = useState(false);
  useEffect(() => {
    const start = () => setNavigating(true);
    const stop = () => setNavigating(false);
    Router.events.on('routeChangeStart', start);
    Router.events.on('routeChangeComplete', stop);
    Router.events.on('routeChangeError', stop);
    return () => { Router.events.off('routeChangeStart', start); Router.events.off('routeChangeComplete', stop); Router.events.off('routeChangeError', stop); };
  }, []);
  return (
    <ThemeProvider>
      <Head><title>التعاون - إدارة محطات الوقود</title></Head>
      <AuthProvider>
        <ToastProvider><RoleRouteGuard>{navigating && <div role="status" aria-label="جارٍ الانتقال للصفحة" style={{ position: 'fixed', inset: '0 0 auto', zIndex: 1000, height: 3, background: 'linear-gradient(90deg, #2563eb, #60a5fa, #2563eb)' }} />}<Component {...pageProps} /></RoleRouteGuard></ToastProvider>
        <InstallAppPrompt />
      </AuthProvider>
    </ThemeProvider>
  );
}
