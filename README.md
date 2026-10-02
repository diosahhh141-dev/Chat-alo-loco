# Entre Amigos

Una app web de chat en tiempo real. Cada persona elige su nombre y entra a una sala usando el mismo código. También se puede compartir un enlace directo a la sala.

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

## Lo que incluye

- Salas identificadas por códigos de 3 a 24 letras, números, guiones o guiones bajos.
- Mensajes en tiempo real, hora local, aviso al entrar/salir y reconexión automática.
- Hasta 100 mensajes recientes por sala, guardados temporalmente en la memoria del servidor.
- Enlace para invitar a otras personas a una sala.

## Límites de esta versión

No hay cuentas ni contraseña para las salas: cualquiera que conozca el código puede entrar. No compartas información sensible. Los mensajes no están cifrados de extremo a extremo y se pierden cuando el servidor se reinicia o vuelve a desplegarse. Esta versión no usa una base de datos.
