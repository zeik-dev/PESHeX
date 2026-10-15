## PESHeX — Pokémon Essential HeX

Editor visual de partidas guardadas (`.rxdata`) de **Pokémon Essentials** y fangames basados en él.

### Novedades de la 1.2.1
- **Pantalla de inicio sin scroll**: «Mis juegos» ya no queda debajo de la tarjeta. Ahora la tarjeta lleva dos tabs, **«Partidas recientes»** y **«Juegos guardados»**, y es el panel de cada tab el que se desplaza por dentro cuando hay muchos elementos: la página nunca hace scroll, a ningún tamaño de ventana. Recuerda el último tab elegido y, la primera vez, abre el de recientes (o el de juegos si todavía no has abierto nada). Los tabs se manejan también con el teclado (flechas, Inicio y Fin).
- **Actualizador más fácil de diagnosticar**: cada actualización deja un registro, `updater.log` (en `%APPDATA%\com.zeik.peshex\updates\`), con lo que hizo y por qué falló si falla; el aviso de error trae el botón **«Mostrar el registro»**. El instalador de actualizaciones también puede aplicar un zip ya descargado (`PESHeX-Updater.exe apply-local`), y el build de Windows prueba ahora una actualización completa con los ejecutables reales —con el `.exe` en uso, rutas con espacios y `ñ`, y retirada de los archivos que ya no existen— antes de publicar el Release.
- *La 1.2.1 es la primera que se puede instalar desde la 1.2.0 con la actualización automática.*

### Novedades de la 1.2.0
- **Actualizaciones automáticas**: PESHeX busca en GitHub Releases (al iniciar, como mucho una vez al día, o a mano en *Ajustes → Actualizaciones*) y avisa con las notas; **descarga con barra de progreso, pausar, reanudar y cancelar**, comprueba el **SHA-256** y reemplaza los archivos con un proceso aparte (`PESHeX-Updater.exe`) que **restaura la versión anterior si algo falla**. La 1.2.0 es la primera que lo incluye: desde la 1.1.0 hay que bajarla a mano una vez. *Limitación: el ejecutable no está firmado, así que la comprobación detecta descargas corruptas pero no demuestra la autoría.*
- **Mis juegos**: biblioteca de fangames en la pantalla de inicio y en Ajustes, con **Save Scan** (encuentra dónde guarda las partidas cada juego, sin copias `.bak`; o eliges la carpeta de guardados a mano), **precarga** con caché de los datos del juego y apertura de partidas con un clic. Las copias de seguridad se nombran con el nombre de cada partida (`Game.rxdata.<fecha>.bak`).
- **Primer arranque**: **español por defecto**, selección de idioma y, si quieres, agregar tu directorio de juego. La carga de la carpeta del juego avisa de que puede tardar varios minutos.
- **Escala automática** proporcional (ancho y alto): todas las pestañas visibles sin scroll y se reajusta al agrandar o maximizar. La ventana **recuerda si estaba maximizada y en qué monitor** y, si no, abre centrada sin parpadeo. Botón **Guardar** junto a *Cerrar archivo* y logo con disco sólido.
- **Editor de Pokémon**: la **ficha, las acciones rápidas y las pestañas quedan fijas**; **estadísticas base / actuales** con el desglose por colores (base y nivel en rojo, IV en azul, EV en naranja, naturaleza en verde) y *tooltips*; el preset de EV sugerido solo está en *IV y EV*; **íconos** de tipo y categoría en los movimientos y de objeto, bola y género en sus selectores; las **naturalezas muestran lo que suben (rojo) y bajan (azul)** y la «Naturaleza efectiva» en negrita.
- **Sprites** que faltaban con la carpeta del juego cargada: *Evolución / Evoluciona de* en la Pokédex y *Especie* en *Agregar Pokémon*.
- **Entrenador**: imagen del entrenador (de `trainertypes` y `metadata`) en el Resumen y en *Entrenador*, y **medallas** con el gráfico del juego.

### Correcciones de la 1.2.0
- **Naturaleza en bases antiguas (p. ej. Pokémon Z)**: cambiarla en el selector no tenía efecto en el juego (se escribía en `@nature` en vez de `@natureflag`). Lo mismo con el **género** y el **brillante**. Corregido, con la partida real de Z.
- **Falsos positivos de legalidad**: «Form 1 of MRRIME does not exist» (las formas por defecto, `DefaultForm_N`, y los huecos entre formas), «This species cannot learn Testarazo (Head Smash)» en Arcanine de Hisui (los movimientos huevo de preevoluciones con forma) y «Move “0” does not exist» en bases antiguas con un hueco de movimiento vacío (también hacía caer la calibración de todo el save).

### Correcciones de la 1.1.0
- **Pokédex**: abrir la ficha de una especie **desconectaba la partida del editor** (la respuesta de las zonas de aparición pisaba el identificador del protocolo y la app daba la conexión por perdida: «No save is open» y el resto de pestañas sin datos hasta volver a cargar). Corregido, con una prueba que comprueba el identificador de cada respuesta. Además la ficha ya no se queda en «Cargando la ficha…»: si el motor tarda o falla, muestra el motivo y un botón para **reintentar**; las zonas y la numeración regional se piden aparte y nunca bloquean la ficha, y un dato raro de una parte opcional ya no la tumba.
- **Selectores de habilidades y movimientos**: con el interruptor «Mostrar solo … de la especie» apagado listan **todas** las opciones del juego (antes se cortaban a 60); al abrirlos se ve la opción actual.
- **Desplegables de los selectores** (movimientos, habilidades, objetos, especies): si no caben debajo del campo —p. ej. el movimiento 4 de un Pokémon de la última fila— se abren **hacia arriba**, y su alto se ajusta al espacio libre para que nunca se salgan de la ventana.
- **Íconos de categoría** (Físico, Especial, Estado) en los movimientos: se leen de `Graphics/Pictures/category.png` de tu carpeta de juego y, si no lo trae, se usan íconos propios (no se incluye arte oficial).

### Novedades de la 1.1.0
- **Equipo y PC a todo el alto**, sin títulos de página: solo el panel de datos hace scroll. Un único botón **Acciones rápidas** (se abre hacia la izquierda) y **clic derecho** en cada casilla: *Editar · Clonar · Exportar · Eliminar* o, en una casilla vacía, **Agregar Pokémon** por especie.
- **La legalidad solo se muestra en HeX**: en HaX no hay interruptores, insignias, pestañas ni tarjetas de legalidad.
- **Hoja de edición ancha**: stats base de la especie en tu juego, deslizadores con campo numérico (nivel, felicidad, PS, IV y EV), Poder oculto, estadísticas totales, **naturaleza por menta**, filtros «solo habilidades / movimientos de la especie» y selector de objeto con icono, nombre e id.
- **Mochila**: *Agregar objeto* arriba, cada objeto va a su bolsillo, MT/MO con su movimiento (*MT01 · Ventisca*) y bolsillo **Megapiedras**.
- **Pokédex con ficha de especie** (datos de tu PBS): stats base, habilidades, debilidades por tipo, evoluciones, formas, movimientos, **dónde encontrarla** y numeración regional; **cintas** con nombre en la información del Pokémon.
- **PBS de Essentials v16 a v21** (CSV e INI) para nombres, MT y datos de las bases antiguas, con nivel, habilidad, naturaleza y bola derivados.
- **Barra de progreso** al cargar la carpeta del juego y aviso al abrir una partida que no tiene una asociada (*No volver a preguntar para esta partida*).

### Novedades de la 1.0.0
- **PC como en los juegos**: cajas 6×5 con los sprites de *tu* juego (Graphics), equipo, panel de datos y arrastrar y soltar (ratón o teclado).
- **Modos HaX y HeX**: HaX (por defecto) permite cualquier cambio; HeX, que se activa a mano con un aviso, no deja introducir Pokémon ni valores ilegales para tu juego y depende de vincular antes la carpeta del juego (puede fallar en algunos fangames).
- **Zoom de la aplicación** en Ajustes (50 %–200 %, por defecto 100 %) y, con HeX activo, una tarjeta de **legalidad desplegable** en el Resumen.
- **Carpeta del juego**: nombres reales, selectores con búsqueda, límites leídos de los scripts y legalidad según tus datos.
- **Pokédex, mundo y copias**: marca vistas/capturadas, edita interruptores y variables con sus nombres, compara y restaura copias `.bak`.
- **Búsqueda global (`Ctrl+K`)**, atajos (`Ctrl+S`, `Ctrl+Z`, `Ctrl+Y`), acciones rápidas (curar, IV al máximo, recalcular estadísticas y siete presets de EV, con el sugerido según los stats más altos del Pokémon) y **clonar / importar / exportar** Pokémon (texto de Pokémon Showdown y JSON).
- Detección automática de la base de Essentials (v16–v21 y bases personalizadas), español e inglés, y todo reversible (deshacer/rehacer, copia `.bak`).

### Cómo usarlo
1. Descarga **`PESHeX-<versión>-windows-x64.zip`**.
2. Extrae **todo** el contenido en una carpeta y abre `PESHeX.exe`. No hay que instalar nada (Ruby viene incluido).
3. Lee `LEEME.txt` (dentro del zip).

> **Sobre Windows SmartScreen / antivirus:** el ejecutable **no está firmado** (la firma de código es de pago), así que Windows puede mostrar «Windows protegió su PC» la primera vez: *Más información → Ejecutar de todas formas*. Puedes comprobar la integridad del zip con `SHA256SUMS.txt`. Los detalles están en `LEEME.txt`.

Requiere Windows 10/11 de 64 bits y Microsoft Edge WebView2 (incluido en Windows 11 y en Windows 10 actualizado).
