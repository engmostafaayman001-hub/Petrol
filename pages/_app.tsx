import '../styles/globals.css';
import { AuthProvider } from '../src/lib/auth';
import { ThemeProvider } from '../src/lib/theme';
import InstallAppPrompt from '../src/components/InstallAppPrompt';

export default function App(props: any) {
  const { Component, pageProps } = props;
  return (
    <ThemeProvider>
      <AuthProvider>
        <Component {...pageProps} />
        <InstallAppPrompt />
      </AuthProvider>
    </ThemeProvider>
  );
}
