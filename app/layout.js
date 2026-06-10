import './globals.css';
import Sidebar from './components/Sidebar';
import Providers from './components/Providers';

export const metadata = {
  title: 'Backstop — the alert that fires when an alert can\'t',
  description:
    'An AI agent reads your real saved-search detections, computes which have gone silently blind from the real last-seen timestamp of the data they depend on, and ranks the blind ones by exposure. Proof-by-silence.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=JetBrains+Mono:wght@400;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Providers>
          <div className="shell">
            <Sidebar />
            <main className="main">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
