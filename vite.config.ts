import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  preview: {
    // Permite que o app seja embedado em tunnels (localtunnel, ngrok, etc.)
    // Necessário para deploy via localtunnel.loca.lt
    allowedHosts: true,
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "robots.txt", "apple-touch-icon.png"],
      manifest: {
        name: "ProntoMedic",
        short_name: "ProntoMedic",
        description: "Sistema de gestão para clínicas e consultórios",
        theme_color: "#2563eb",
        background_color: "#ffffff",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/",
        lang: "pt-BR",
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2}"],
        navigateFallback: "/offline.html",
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "supabase-api",
              expiration: { maxEntries: 200, maxAgeSeconds: 600 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "google-fonts-stylesheets",
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "images",
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ]
    .filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Split dependencies into separate vendor chunks for better long-term caching
        // and to reduce initial bundle size.
        manualChunks: {
          "react-vendor": ["react", "react-dom", "react-router-dom"],
          "supabase-vendor": ["@supabase/supabase-js"],
          "ui-vendor": [
            "@radix-ui/react-dialog",
            "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-popover",
            "@radix-ui/react-select",
            "@radix-ui/react-tabs",
            "@radix-ui/react-tooltip",
            "@radix-ui/react-toast",
            "@radix-ui/react-switch",
            "@radix-ui/react-label",
            "@radix-ui/react-slot",
            "@radix-ui/react-scroll-area",
            "@radix-ui/react-separator",
            "@radix-ui/react-progress",
            "@radix-ui/react-checkbox",
            "@radix-ui/react-radio-group",
            "@radix-ui/react-slider",
            "@radix-ui/react-accordion",
            "@radix-ui/react-alert-dialog",
            "@radix-ui/react-avatar",
            "@radix-ui/react-collapsible",
            "@radix-ui/react-context-menu",
            "@radix-ui/react-hover-card",
            "@radix-ui/react-menubar",
            "@radix-ui/react-navigation-menu",
            "@radix-ui/react-aspect-ratio",
            "@radix-ui/react-toggle",
            "@radix-ui/react-toggle-group",
          ],
          "chart-vendor": ["recharts"],
          "date-vendor": ["date-fns", "react-day-picker"],
          "form-vendor": ["react-hook-form", "@hookform/resolvers", "zod"],
          "query-vendor": ["@tanstack/react-query"],
          "pwa": ["virtual:pwa-register"],
          "utils-vendor": [
            "clsx",
            "tailwind-merge",
            "class-variance-authority",
            "lucide-react",
            "sonner",
            "cmdk",
            "vaul",
            "input-otp",
            "embla-carousel-react",
            "next-themes",
            "react-resizable-panels",
            "dompurify",
          ],
        },
      },
    },
  },
}));
