/** @type {import('next').NextConfig} */
const nextConfig = {
  // native/server-only modules — keep them external to the server bundle.
  serverExternalPackages: ['pg', 'better-sqlite3'],
};

export default nextConfig;
