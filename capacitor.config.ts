import type { CapacitorConfig } from '@capacitor/cli';

// Spec §5. `androidScheme: 'https'` es lo que hace que el WebView sirva la app
// desde https://localhost — contexto seguro, sin el cual no hay OPFS y el
// worker muere con fatal(reason:'vfs'). Live reload (`cap run -l`) sirve por
// http:// y por eso NO está soportado.
const config: CapacitorConfig = {
  appId: 'com.hubtify.app',
  appName: 'Hubtify',
  webDir: 'dist/mobile',
  server: { androidScheme: 'https' },
  android: { allowMixedContent: false },
};

export default config;
