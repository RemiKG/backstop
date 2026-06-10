/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  // The agent talks to Splunk + Vertex from server routes only; no client secrets.
  experimental: {},
};

export default nextConfig;
