export const metadata = {
  title: 'Auto Marketplace Tracker',
  description: 'Facebook Marketplace vehicle listings — tracked over time',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
