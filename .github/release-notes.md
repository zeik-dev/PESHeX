## PESHeX — Pokémon Essential HeX

Editor visual de partidas guardadas (`.rxdata`) de **Pokémon Essentials** y fangames basados en él.

### Correcciones de la 1.1.0
- **Pokédex**: la ficha de especie ya no se queda en «Cargando la ficha…»: si el motor tarda o falla, muestra el motivo y un botón para **reintentar**; las zonas y la numeración regional se piden aparte y nunca bloquean la ficha, y un dato raro de una parte opcional ya no la tumba.
- **Selectores de habilidades y movimientos**: con el interruptor «Mostrar solo … de la especie» apagado listan **todas** las opciones del juego (antes se cortaban a 60); al abrirlos se ve la opción actual.
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
