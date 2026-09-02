package com.hubtify.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // registerPlugin() va ANTES de super.onCreate(): así lo confirma la doc
        // de Capacitor 8 para plugins locales (capacitorjs.com/docs/android/custom-code).
        registerPlugin(ApkInstallerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
