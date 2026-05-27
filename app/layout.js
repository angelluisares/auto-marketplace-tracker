export const metadata = {
  title: 'Sprinter Tracker',
  description: 'Facebook Marketplace van listings — tracked over time',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
