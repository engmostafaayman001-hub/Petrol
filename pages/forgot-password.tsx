import React, { FormEvent, useState } from 'react';
import Link from 'next/link';
import supabase from '../src/lib/supabaseClient';

export default function ForgotPassword() {
  const [email, setEmail] = useState(''); const [message, setMessage] = useState<string | null>(null); const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); setLoading(true); setMessage(null); const redirectTo = `${window.location.origin}/reset-password`; const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo }); setMessage(error ? 'تعذر إرسال رابط الاستعادة. تحقق من البريد الإلكتروني وحاول مرة أخرى.' : 'إذا كان البريد الإلكتروني مسجلاً، فسيصلك رابط لإعادة تعيين كلمة المرور.'); setLoading(false); }
  return <main className="login-page"><section className="login-panel w-full"><div className="login-card"><Link href="/signin" className="login-link">العودة إلى تسجيل الدخول</Link><h1 className="login-title mt-8">استعادة كلمة المرور</h1><p className="login-subtitle mt-2">أدخل بريدك الإلكتروني وسنرسل لك رابطاً آمناً لتعيين كلمة مرور جديدة.</p><form onSubmit={submit} className="mt-8 form-grid"><div className="form-field"><label htmlFor="email">البريد الإلكتروني</label><input id="email" required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" /></div>{message && <p className="rounded-xl bg-blue-50 p-3 text-sm text-blue-800">{message}</p>}<button className="login-button" disabled={loading}>{loading ? 'جارٍ الإرسال…' : 'إرسال رابط الاستعادة'}</button></form></div></section></main>;
}
