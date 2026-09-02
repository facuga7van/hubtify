# Hubtify Android — release, firma y distribución

Complementa `docs/superpowers/specs/2026-09-01-mobile-android-design.md` (§5, §8) y
la skill `~/.claude/skills/release` del usuario (el flujo de versión es el mismo:
bump + tag `v*`).

> **Sin los 4 secrets de §3, el próximo tag no publica NADA**: `publish` espera a
> `build-android`, y ese job falla a propósito si falta el keystore. Cargarlos
> antes del primer tag posterior al merge de `feature/mobile`.

## 1. El keystore

Un APK solo puede actualizar a otro **firmado con la misma clave**. Perder el
keystore = los usuarios tienen que desinstalar y volver a instalar (y pierden la
base local si no exportaron). Por eso:

- El `.jks` y sus contraseñas viven en el gestor de contraseñas **y** como secrets
  del repo. Nunca en git: `android/keystore/` está en `.gitignore`.
- Generar uno nuevo (solo la primera vez, o si se decide rotar la clave y
  aceptar la reinstalación):

  ```bash
  export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.5.11-hotspot"
  mkdir -p android/keystore        # keytool no crea el directorio
  "$JAVA_HOME/bin/keytool" -genkeypair -v -storetype PKCS12 \
    -keystore android/keystore/release.jks -alias hubtify \
    -keyalg RSA -keysize 2048 -validity 10000
  ```

  PKCS12 usa **una** contraseña para el almacén y la clave.

## 2. Firma local: `android/keystore/keystore.properties`

```properties
storeFile=release.jks
storePassword=<contraseña>
keyAlias=hubtify
keyPassword=<contraseña>
```

`android/app/build.gradle` lo lee si existe. Si no existe pero están las variables
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` (y
`android/keystore/release.jks`), usa eso (es lo que hace CI). Sin nada de lo
anterior, `assembleRelease` firma con la clave **debug** y el log de Gradle avisa
`[hubtify] release signing: DEBUG key`: ese APK sirve para probar, no para publicar.

```bash
npm run mobile:apk:release      # dist/mobile → cap sync → assembleRelease
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --print-certs \
  android/app/build/outputs/apk/release/app-release.apk
```

## 3. Secrets del repo (`facuga7van/hubtify`)

Cuatro secrets, cargados con `gh` desde una shell con el keystore local ya armado.
Los tres de texto se toman de `keystore.properties` sin pasar por la pantalla. En
`.properties` la barra invertida va escapada (`\\`); Gradle lee las variables de
entorno crudas, así que el `node -p` la des-escapa (`.replace(/\\\\/g, '\\')`).
Lo más simple es elegir una contraseña ASCII sin `\`.

```bash
base64 -w0 android/keystore/release.jks | gh secret set ANDROID_KEYSTORE_BASE64 --repo facuga7van/hubtify
prop() { node -p "require('fs').readFileSync('android/keystore/keystore.properties','utf8').match(/^$1=(.*)$/m)[1].replace(/\\\\\\\\/g, '\\\\')"; }
prop storePassword | gh secret set ANDROID_KEYSTORE_PASSWORD --repo facuga7van/hubtify
prop keyAlias      | gh secret set ANDROID_KEY_ALIAS --repo facuga7van/hubtify
prop keyPassword   | gh secret set ANDROID_KEY_PASSWORD --repo facuga7van/hubtify
gh secret list --repo facuga7van/hubtify | rg ANDROID
```

`release.yml` decodifica `ANDROID_KEYSTORE_BASE64` a `android/keystore/release.jks`,
compila con las variables de entorno, verifica con `apksigner`, renombra a
`Hubtify-<version>.apk`, borra el keystore del runner (`if: always()`) y sube el
APK como artifact. El job `publish` lo adjunta al mismo release de
`facuga7van/hubtify-releases` que el instalador de Windows. Si falta el secret del
keystore el job falla con `::error::` — un release sin APK firmado no se publica a
medias.

## 4. `versionCode` y `versionName`

`scripts/android-version.mjs` (corre en `npm run mobile:sync`, también en CI)
escribe en `android/app/build.gradle`:

- `versionName` = `version` de `package.json` (lo que ve el usuario).
- `versionCode` = `major*10000 + minor*100 + patch` (0.8.2 → 802). Android exige
  que **suba** en cada actualización; con esta fórmula sube solo con la versión de
  `package.json`, así que **cada APK publicado necesita un bump de versión**. Un
  `adb install -r` con un `versionCode` menor falla con
  `INSTALL_FAILED_VERSION_DOWNGRADE` (desinstalar primero). Minor o patch > 99
  rompen el orden: el script lo rechaza.

## 5. Instalar el APK (sideload)

- Con cable/emulador: `adb install -r Hubtify-<version>.apk` (`-r` = reemplazar
  conservando datos). `INSTALL_FAILED_UPDATE_INCOMPATIBLE` significa que el APK
  instalado está firmado con otra clave (típicamente el debug de `mobile:apk`):
  `adb uninstall com.hubtify.app` y volver a instalar.
- Sin cable: bajar `Hubtify-<version>.apk` desde el release en el teléfono, abrirlo
  y permitir «instalar apps desconocidas» para el navegador. La app avisa cuando
  hay una versión nueva y abre esa descarga (updater mobile, Fase 5).

## 6. Checklist de un release con Android

1. `package.json` con la versión nueva, changelog en `src/shared/changelog.ts`.
2. Tag `vX.Y.Z` (skill `release`). `release.yml` corre `build-windows` y
   `build-android` en paralelo y `publish` al final.
3. Verificar en el release: `.exe`, `.nupkg`, `RELEASES`, `.zip` y
   `Hubtify-X.Y.Z.apk`.
4. En un teléfono con la versión anterior: bajar el APK y actualizar sobre la
   instalada (misma firma + `versionCode` mayor). Si algo falla, ver §4/§5.
