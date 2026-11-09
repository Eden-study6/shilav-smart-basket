import type { Metadata } from 'next';
import { Heebo } from 'next/font/google';
import './globals.css';

/** Heebo carries a full Hebrew glyph set and reads cleanly at small sizes on mobile. */
const heebo = Heebo({
  variable: '--font-heebo',
  subsets: ['hebrew', 'latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'שילב | הסל החכם שלי',
  description:
    'סל מותאם אישית לתינוק שלך – לפי שלב ההתפתחות, המידה הנוכחית והעונה. שילב.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /*
     * suppressHydrationWarning: browser extensions (translators, password
     * managers) inject attributes and nodes into <html>/<body> before React
     * hydrates, which React reports as a hydration mismatch even though the
     * app's own markup matches. This silences that class of noise; it does not
     * hide mismatches inside our components.
     */
    <html
      lang="he"
      dir="rtl"
      className={`${heebo.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body
        className="min-h-full flex flex-col bg-cream-100 text-ink font-sans"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
