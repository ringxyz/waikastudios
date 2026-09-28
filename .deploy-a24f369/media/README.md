# Secuencia del giro del hero

`giro-frames/` contiene 60 fotogramas WebP del recorrido por el bosque. `app.js`
elige el fotograma según el progreso de scroll del hero, por lo que la animación
avanza y retrocede con el desplazamiento sin descargar un GIF o reproducir un vídeo.

`waika-bosque-hero-poster.jpg` funciona como respaldo mientras carga el primer
fotograma y cuando el visitante tiene activada la preferencia de movimiento reducido.
Este directorio no contiene credenciales ni llama a Higgsfield desde el navegador.
