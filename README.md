# Entre Amigos

Una app web de chat en tiempo real. Cada persona elige su nombre y entra a una sala usando el mismo código. También se puede compartir un enlace directo a la sala y enviar imágenes.

## Ejecutar en tu computadora

Necesitas Node.js 20 o posterior.

1. Abre una terminal dentro de esta carpeta.
2. Ejecuta `npm install`.
3. Ejecuta `npm start`.
4. Abre `http://localhost:3000` en tu navegador.
5. Para probar entre dispositivos de la misma red, usa la dirección IP local de la computadora que ejecuta el servidor.

Para hablar con amigos que están fuera de tu red, publica la app en un servicio web siguiendo los pasos de abajo.

## Publicarla con Render

1. Crea un repositorio nuevo en GitHub y sube el contenido de esta carpeta.
2. En Render, crea un **Web Service** y conecta ese repositorio.
3. Configura **Build Command** como `npm install` y **Start Command** como `npm start`.
4. Espera a que termine la publicación. Render mostrará la dirección pública de la app.
5. Comparte esa dirección con tus amigos. Dentro del chat, pulsa **Copiar invitación** para compartir un enlace que ya incluye el código de sala.

El servidor escucha en el puerto indicado por `PORT`, como requieren los servicios web de Render. Revisa sus [instrucciones oficiales para desplegar Node y Express](https://render.com/docs/deploy-node-express-app) y las [limitaciones del plan gratuito](https://render.com/docs/free) antes de elegir un plan.

## Actualizar la app que ya está en GitHub y Render

1. En GitHub, reemplaza `server.js` por el archivo nuevo de esta carpeta y confirma el cambio.
2. Abre la carpeta `public` del repositorio. Reemplaza `app.js`, `index.html` y `styles.css` por los archivos de la carpeta `public` de esta entrega y confirma los cambios.
3. Espera a que Render despliegue el commit más reciente. Si no empieza solo, abre el servicio y pulsa **Manual Deploy → Deploy latest commit**.

## Lo que incluye

- Salas identificadas por códigos de 3 a 24 letras, números, guiones o guiones bajos.
- Mensajes en tiempo real, hora local, aviso al entrar/salir y reconexión automática.
- Herramientas de administración por comandos, clave privada y etiquetas CREATOR/ADMIN.
- Responder a mensajes o imágenes deslizando a la izquierda en el teléfono, o con el botón **Responder**.
- Envío de imágenes JPG, PNG o WEBP. La app las reduce antes de enviarlas.
- Se envían como JPG de hasta 1 MB después de comprimirlas.
- Hasta 100 mensajes recientes por sala, guardados temporalmente en la memoria del servidor.
- Las imágenes se guardan temporalmente en la memoria del servidor; conserva hasta 32 imágenes recientes en total. Las más antiguas pueden dejar de verse.
- Enlace para invitar a otras personas a una sala.

## Administración de salas

Al entrar a una sala, el creador escribe una clave privada de al menos 8 caracteres en el campo de administrador. La primera clave registrada en esa sala identifica al creador. Comparte esa misma clave únicamente con coadministradores; los demás deben dejar el campo vacío. Los controles y claves se guardan en memoria y se reinician cuando el servidor de Render se reinicia o vuelve a desplegarse.

Escribe `/ayuda` en el chat para ver los comandos disponibles:

| Comando | Función |
| --- | --- |
| `/silenceadmin` o `/sinlenceadmin` | Deja escribir solo a administradores. |
| `/todos` | Vuelve a permitir que todos escriban. |
| `/ban NOMBRE` | Bloquea ese nombre y expulsa a la persona conectada. |
| `/desban NOMBRE` | Quita el bloqueo del nombre. |
| `/expulsar NOMBRE` | Saca de la sala a esa persona sin bloquearla. |
| `/silenciar NOMBRE` | Impide que ese nombre envíe mensajes. |
| `/desilenciar NOMBRE` | Le permite escribir de nuevo. |
| `/anuncio TEXTO` | Muestra un aviso destacado para todos. |
| `/quitaranuncio` | Quita el aviso destacado. |
| Botón **Borrar** | Elimina el mensaje seleccionado (solo administradores). |
| `/borrarultimo` | Elimina el último mensaje. |
| `/limpiarsala` | Borra todo el historial y las imágenes de la sala. |
| `/cerrarsala` | Cierra la sala y saca a todos. |

Los bloqueos y silencios se aplican al nombre escrito por la persona, por lo que esta versión no evita que vuelva a entrar con otro nombre. No hay cuentas de usuario.

## Límites de esta versión

No hay cuentas ni contraseña para las salas: cualquiera que conozca el código puede entrar. No compartas información sensible. Los mensajes y las imágenes no están cifrados de extremo a extremo y se pierden cuando el servidor se reinicia o vuelve a desplegarse. Esta versión no usa una base de datos ni almacenamiento permanente.
