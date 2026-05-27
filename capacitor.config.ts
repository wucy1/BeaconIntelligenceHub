import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'org.undp.bih',
  appName: 'Beacon Intelligence Hub',
  webDir: 'frontend/dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
