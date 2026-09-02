package com.hubtify.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/**
 * Plugin LOCAL (no es un paquete npm) para el update in-app (ver
 * src/mobile/apk-installer.ts, registrado como "ApkInstaller"). El único
 * trabajo que hace es lo que WebView no puede: lanzar el instalador del
 * sistema sobre un APK ya descargado en el cache de la app, y decir si falta
 * el permiso de "instalar apps desconocidas" antes de intentarlo.
 */
@CapacitorPlugin(name = "ApkInstaller")
public class ApkInstallerPlugin extends Plugin {

    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("allowed", canRequestPackageInstalls());
        call.resolve(ret);
    }

    @PluginMethod
    public void install(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("path is required");
            return;
        }

        if (!canRequestPackageInstalls()) {
            // API 26+: sin este permiso, ACTION_VIEW sobre un APK no hace nada.
            // Se manda a la pantalla de sistema para que lo conceda una vez;
            // el banner (AndroidUpdateBanner.tsx) le pide que vuelva a tocar
            // «Instalar» después.
            Intent settingsIntent = new Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + getContext().getPackageName())
            );
            settingsIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(settingsIntent);

            JSObject ret = new JSObject();
            ret.put("needsPermission", true);
            call.resolve(ret);
            return;
        }

        File file = resolveFile(path);
        if (file == null || !file.exists()) {
            call.reject("apk file not found: " + path);
            return;
        }

        Uri uri = FileProvider.getUriForFile(
            getContext(),
            getContext().getPackageName() + ".fileprovider",
            file
        );

        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.setFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);

        JSObject ret = new JSObject();
        ret.put("needsPermission", false);
        call.resolve(ret);
    }

    private boolean canRequestPackageInstalls() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return getContext().getPackageManager().canRequestPackageInstalls();
        }
        // Antes de API 26 el permiso es a nivel de sistema (Ajustes > Seguridad),
        // no por-app: si el usuario lo activó, ya está permitido.
        return true;
    }

    /** El lado TS pasa la `file://` uri que devuelve Filesystem.getUri(). */
    private File resolveFile(String path) {
        if (path.startsWith("file://")) {
            return new File(Uri.parse(path).getPath());
        }
        return new File(path);
    }
}
