import Document, { Html, Head, Main, NextScript } from 'next/document';

export default class MyDocument extends Document {
  override render() {
    return (
      <Html lang="ar" dir="rtl">
        <Head><title>PETROL — نظام إدارة محطات الوقود</title><meta name="description" content="منصة PETROL لإدارة مخزون ومبيعات وتوريدات محطات الوقود." /><meta name="theme-color" content="#071A32" /></Head>
        <body>
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}
