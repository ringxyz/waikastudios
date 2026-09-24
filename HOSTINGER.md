# Publicar en Hostinger

Este repositorio está preparado para importarse como aplicación Node.js.

Configuración de Hostinger:

- Repositorio: `ringxyz/waikastudios`
- Rama: `main`
- Comando de instalación: `npm install`
- Comando de inicio: `npm start`
- Versión de Node.js: 24 LTS (o 22 LTS mientras Hostinger complete la actualización)
- Puerto: el que proporcione Hostinger mediante `PORT`
- Carpeta pública: no hace falta configurarla; `server.js` sirve `dist`

Variables que deben añadirse en el panel de Hostinger, nunca en GitHub:

- `FORM_SIGNING_SECRET`: cadena aleatoria larga para firmar los desafíos del formulario.
- `MAKE_ONBOARDING_WEBHOOK_URL`: URL del webhook de Make que recibe el briefing.
- `ANTHROPIC_API_KEY`: clave privada para el chatbot; solo se usa en el servidor.
- `ANTHROPIC_MODEL`: modelo activo de Claude, por defecto `claude-sonnet-5`.
- `PUBLIC_SITE_ORIGIN`: origen público exacto, por ejemplo `https://tudominio.com`.
- `TRUST_HOSTINGER_CDN`: cambiar a `true` solo cuando el tráfico entre al servidor a través del CDN de Hostinger; entonces se usa la IP que Hostinger añade al final de `X-Forwarded-For`.

No subas `.env` ni claves reales. `.env.example` solo documenta los nombres necesarios. El briefing se entrega a Make; el correo de confirmación debe enviarlo el escenario únicamente después de guardar el documento en Drive. Esa última etapa requiere revisar la conexión al escenario antes de activar el flujo público.

## Cierre SEO antes del lanzamiento

El dominio definitivo aún no está configurado. `PUBLIC_SITE_ORIGIN` debe ser el origen HTTPS elegido, sin ruta, consulta ni fragmento (por ejemplo, `https://www.tudominio.com`). El servidor usa ese valor para canonicals, Open Graph, JSON-LD, `robots.txt` y `sitemap.xml`; también redirige los otros hosts HTTPS a esa variante. Mientras el origen canónico no esté configurado, la vista previa y cualquier host no coincidente se sirven con `X-Robots-Tag: noindex` para evitar que compitan con el sitio final.

Una vez asignado el dominio y comprobado el SSL:

1. Verificar desde fuera del hosting que HTTP pasa a HTTPS y que `www`/sin `www` redirigen a la variante elegida.
2. Comprobar en la URL pública `/robots.txt`, `/sitemap.xml`, canonicals, `X-Robots-Tag`, el 404 y la imagen social. El sitemap debe listar solo inicio, presupuesto, proyectos y preguntas.
3. Crear una propiedad **Dominio** en Google Search Console y verificarla con el TXT que proporciona Search Console en el DNS del dominio.
4. Enviar `https://<dominio-canónico>/sitemap.xml` en Search Console; inspeccionar las cuatro páginas públicas, comprobar la canonical seleccionada y solicitar rastreo cuando todo responda bien.
5. Dar de alta el dominio en Bing Webmaster Tools (verificación DNS o importación desde Search Console) y enviar el mismo sitemap.
6. Medir la portada y las páginas principales con PageSpeed Insights en móvil y escritorio. Revisar Core Web Vitals en Search Console cuando haya datos de usuarios; una prueba de laboratorio no garantiza métricas de campo.
7. Volver a revisar cobertura/indexación y errores después del rastreo. Enviar un sitemap o pedir indexación no garantiza que un buscador indexe una página.

El alta en Search Console/Bing y la verificación pública quedan pendientes hasta conocer el dominio definitivo y tener acceso a su DNS/cuentas. La autoridad del dominio tampoco se obtiene por una configuración técnica ni puede garantizarse: dependerá de contenido útil, reputación y enlaces legítimos a lo largo del tiempo.

## Bloqueos de producción que no debe ocultar el lanzamiento

- **Antispam y costes:** el rate limit y la deduplicación actuales residen en memoria del proceso; sirven como defensa auxiliar, no como límite compartido entre reinicios o instancias. Antes de abrir el briefing/chat al público, configurar una capa persistente/perimetral, verificación Turnstile en servidor y límites de gasto del proveedor de IA. No se han configurado ni probado desde este repo.
- **Make:** el Worker envía clave de idempotencia, pero el escenario debe verificar una firma/timestamp y deduplicar en almacenamiento persistente. Una URL privada del webhook por sí sola no sustituye esa validación.
- **Privacidad/legal:** confirmar responsable legal y domicilio, proveedores/subencargados, transferencias y plazo de conservación del briefing; pedir revisión legal de los textos finales.
- **Contenido SEO:** confirmar los datos de organización y activar el dominio canónico antes de indexar. La web en inglés comparte actualmente las mismas URLs y no constituye una versión SEO inglesa independiente.
- **Muestras de aplicaciones:** `/aplicaciones` conserva marcadores de captura pendiente, por eso no está en el sitemap ni se indexa. Sustituirlos por capturas reales y revisadas para ocultar datos personales antes de habilitar su indexación.
- **Tipografías externas:** las páginas solicitan fuentes a Google Fonts. Antes del lanzamiento, autoalojarlas o confirmar su tratamiento en el aviso de privacidad y su impacto en rendimiento.
- **Verificación real:** esta lista describe preparación del repo; no prueba la respuesta del dominio, las cabeceras que entregue el CDN ni la propiedad en Search Console.
