import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config) => {
    // pdf.js has an optional Node-only dependency on "canvas"; skip it in the browser.
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;
