# Publicar en Hostinger

Este repositorio está preparado para importarse como aplicación Node.js.

Configuración de Hostinger:

- Repositorio: `ringxyz/waikastudios`
- Rama: `main`
- Comando de instalación: `npm install`
- Comando de inicio: `npm start`
- Versión de Node.js: 18 o superior
- Puerto: el que proporcione Hostinger mediante `PORT`
- Carpeta pública: no hace falta configurarla; `server.js` sirve `dist`

Variables que deben añadirse en el panel de Hostinger, nunca en GitHub:

- `RESEND_API_KEY`: clave privada de Resend.
- `FORM_SIGNING_SECRET`: cadena aleatoria larga para firmar los desafíos del formulario.
- `BRIEFING_FROM_EMAIL`: remitente autorizado por Resend, por ejemplo `Waika Studios <hola@tudominio.com>`.
- `BRIEFING_REPLY_TO`: correo al que se responderán las confirmaciones.
- `PUBLIC_SITE_ORIGIN`: origen público exacto, por ejemplo `https://tudominio.com`.

No subas `.env` ni claves reales. `.env.example` solo documenta los nombres necesarios.
