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
  // Fondo del WebView NATIVO (Bridge.java: webView.setBackgroundColor). Sin
  // esto queda el default de Android, blanco, y se ve entre el splash y el
  // primer paint de la web. Mismo cuero (leather-dark) que el splash y que el
  // windowBackground de styles.xml.
  backgroundColor: '#2a1d0e',
  android: { allowMixedContent: false },
  plugins: {
    // Iconos claros en la barra de estado y en la de gestos, sobre el cuero de
    // la cabecera (spec §7). SystemBars es el plugin core de Capacitor 8 y es
    // el que inyecta --safe-area-inset-* (insetsHandling 'css'). StatusBar
    // (instalado en la Fase 2) se configura igual para que al cargar no pise
    // el estilo con su default; setBackgroundColor/overlaysWebView no
    // funcionan con targetSdk 36 (README del plugin), por eso no se llaman.
    SystemBars: { style: 'DARK', insetsHandling: 'css' },
    StatusBar: { style: 'DARK', overlaysWebView: true },
  },
};

export default config;
