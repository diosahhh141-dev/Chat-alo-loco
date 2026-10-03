# Entre Amigos

Chat web para salas privadas con cuentas por correo, perfiles, historias de 24 horas, fotos y videos, mensajes guardados y avisos.

## Preparar Supabase

La app usa Supabase Auth, Database y Storage. Hay que ejecutar estos pasos una vez:

1. Crea un proyecto en [Supabase](https://supabase.com/dashboard).
2. En el proyecto, abre **SQL Editor → New query**.
3. Copia todo el archivo `supabase/schema.sql`, pégalo y pulsa **Run**.
4. En **Project Settings → API**, copia la URL del proyecto, la clave pública/anon y la clave secreta `service_role` (o la clave secreta equivalente del proyecto).

La clave `service_role` es privada: no la subas a GitHub, no la pegues en el navegador y no la compartas en el chat. Guárdala solamente como variable de entorno en Render.

En Supabase abre **Authentication → URL Configuration** y configura como **Site URL** la dirección de Render de la app. Añade esa misma dirección a las URL permitidas para que los enlaces de confirmación del correo regresen al sitio.

## Conectar Supabase con Render

1. Abre el servicio de Render de esta app.
2. Entra en **Environment** y añade estas variables:
   - `SUPABASE_URL`: URL del proyecto.
   - `SUPABASE_ANON_KEY`: clave pública/anon (también acepta `SUPABASE_PUBLISHABLE_KEY`).
   - `SUPABASE_SERVICE_ROLE_KEY`: clave secreta privada (también acepta `SUPABASE_SECRET_KEY`).
3. Guarda los cambios y espera a que Render termine el despliegue.
4. Abre la web y crea tu cuenta con correo, contraseña y nombre. Si Supabase pide confirmar el correo, abre el correo y confirma la cuenta.

Si las tres variables no están configuradas, el sitio conserva el chat anónimo anterior y las pantallas de perfiles quedan apagadas.

## Cómo usarla

- Cada amigo crea su propia cuenta con correo y contraseña.
- En **Mi perfil**, cada persona cambia su nombre, descripción y foto.
- En **Inicio**, mira historias y perfiles. Las historias admiten JPG, PNG, WEBP, MP4 y WEBM de hasta 50 MB y vencen a las 24 horas.
- Pulsa **Ir al chat**. Quien cree una sala elige un código y una contraseña; los demás usan esos mismos datos.
- El creador puede registrar una clave de administrador de al menos 8 caracteres al entrar. Comparte esa clave solo con tus coadministradores.
- Pulsa la campana para permitir avisos del navegador. Los avisos en pantalla se reciben cuando la pestaña está en segundo plano y el navegador permite notificaciones.
- Los mensajes se guardan en Supabase. Se pueden responder con el botón o deslizando el mensaje hacia la izquierda en el teléfono.

## Comandos de sala

Escribe `/ayuda` dentro del chat para ver los comandos. Incluye modo solo administradores (`/silenceadmin` o `/sinlenceadmin`), volver a habilitar mensajes (`/todos`), bloquear o silenciar personas, publicar avisos y borrar mensajes. La contraseña de sala, mensajes, historias activas, perfiles y avisos se guardan en Supabase; algunos controles de moderación por nombre se reinician si Render reinicia el servidor.

## Ejecutar localmente

Necesitas Node.js 20 o posterior.

1. Abre una terminal en esta carpeta y ejecuta `npm install`.
2. Ejecuta `npm start`.
3. Abre `http://localhost:3000`.

Para usar perfiles y guardado local, configura las tres variables de entorno de Supabase antes de iniciar el servidor.

## Recursos y límites

El proyecto de Supabase debe seguir activo y dentro de sus cuotas. Las historias vencidas dejan de mostrarse inmediatamente y el servidor borra sus archivos al ejecutar la limpieza periódica. No hay cifrado de extremo a extremo: no uses esta app para intercambiar datos confidenciales.
