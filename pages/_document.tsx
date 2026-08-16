import Document, { Html, Head, Main, NextScript } from 'next/document';

export default class MyDocument extends Document {
  override render() {
    return (
      <Html lang="ar" dir="rtl" data-scroll-behavior="smooth">
      <Head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#1769f5" />
          <meta name="description" content="منصة PETROL لإدارة مخزون ومبيعات وتوريدات محطات الوقود." />
          <meta name="theme-color" content="#071A32" />
          <link rel="icon" href="/petrol-station.svg" type="image/svg+xml" />
        </Head>
        <body>
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}
