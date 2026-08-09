import React, { FormEvent, useState } from 'react';
import Link from 'next/link';
import supabase from '../src/lib/supabaseClient';

export default function ResetPassword() {
  const [password, setPassword] = useState(''); const [message, setMessage] = useState<string | null>(null); const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); setLoading(true); setMessage(null); const { error } = await supabase.auth.updateUser({ password }); setMessage(error ? 'تعذر تحديث كلمة المرور. تأكد من أن الرابط صالح ثم حاول مرة أخرى.' : 'تم تحديث كلمة المرور بنجاح. يمكنك تسجيل الدخول الآن.'); setLoading(false); }
  return <main className="login-page"><section className="login-panel w-full"><div className="login-card"><Link href="/signin" className="login-link">العودة إلى تسجيل الدخول</Link><h1 className="login-title mt-8">تعيين كلمة مرور جديدة</h1><p className="login-subtitle mt-2">اختر كلمة مرور قوية مكونة من ستة أحرف على الأقل.</p><form onSubmit={submit} className="mt-8 form-grid"><div className="form-field"><label htmlFor="password">كلمة المرور الجديدة</label><input id="password" required minLength={6} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>{message && <p className="rounded-xl bg-blue-50 p-3 text-sm text-blue-800">{message}</p>}<button className="login-button" disabled={loading}>{loading ? 'جارٍ الحفظ…' : 'حفظ كلمة المرور'}</button></form></div></section></main>;
}
