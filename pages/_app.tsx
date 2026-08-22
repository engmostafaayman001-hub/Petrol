import '../styles/globals.css';
import { AuthProvider } from '../src/lib/auth';
import { ThemeProvider } from '../src/lib/theme';
import InstallAppPrompt from '../src/components/InstallAppPrompt';
import RoleRouteGuard from '../src/components/RoleRouteGuard';
import { ToastProvider } from '../src/components/ToastProvider';

export default function App(props: any) {
  const { Component, pageProps } = props;
  return (
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider><RoleRouteGuard><Component {...pageProps} /></RoleRouteGuard></ToastProvider>
        <InstallAppPrompt />
      </AuthProvider>
    </ThemeProvider>
  );
}
