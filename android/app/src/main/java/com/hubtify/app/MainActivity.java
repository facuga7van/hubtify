package com.hubtify.app;

import com.getcapacitor.BridgeActivity;

/**
 * Sin plugins locales a propósito. Acá vivía un registerPlugin(ApkInstallerPlugin.class)
 * para el update in-app: instalar un APK desde la app exige
 * android.permission.REQUEST_INSTALL_PACKAGES, permiso que la política de Play
 * reserva a las apps cuyo propósito CENTRAL es instalar paquetes. Declararlo
 * sin calificar no es un rechazo del release: es la suspensión de la cuenta.
 * La actualización la hace Obtainium (app aparte, sigue los mismos releases de
 * GitHub); Hubtify solo avisa y abre la página del release en el navegador.
 */
public class MainActivity extends BridgeActivity {}
