# 🎧 Listening — practicá inglés con tus propios videos

Subís un video, la app le saca los subtítulos en inglés (IA local con Whisper), los traduce al español y te deja
marcar fragmentos para repetirlos las veces que quieras, a la velocidad que quieras y con los subtítulos que quieras.

## Qué podés hacer

- **Traer videos de YouTube**: pegá el link en el cuadro de arriba de la pantalla inicial (o tocá 📋 Pegar) y el video se baja solo a tu carpeta de videos, con relojito de avance. Hasta 1080p, un video a la vez por link; si ya lo tenías te avisa. Solo anda desde la compu donde corre el programa.
- **Mis palabras** 📚: mientras mirás un video, **tocá cualquier palabra del subtítulo en inglés**: ves cómo se traduce (con otros significados para elegir), la guardás con un clic y queda subrayada cuando vuelve a aparecer. Después la repasás con tarjetas que **vuelven a reproducir la frase del video donde la escuchaste**. Mirá más abajo.
- **Subtítulos automáticos** (✨ Auto): al abrir un video sin subtítulos se traen solos (se puede desactivar). Un relojito muestra el avance y cuánto falta.
  Con placa NVIDIA usa Whisper con la placa; sin NVIDIA usa *faster-whisper*, que en el procesador es bastante más rápido, y corta las frases donde hay pausas largas (se fuerza uno u otro con `LISTENING_WHISPER=openai` o `faster`).
  Si ya están, el botón queda en *✓ Ya traídos*; con *↻ Volver a traer* los regenerás (con confirmación).
- **Traducción al español** (🌐 Traducir) en pocos segundos, con progreso y errores claros. También podés importar o bajar `.srt`.
- **Fragmentos**: marcá inicio y fin; cada fragmento tiene sus *vueltas*, y cada vuelta su velocidad (0.5x – 2x, con 0.8 / 0.85 / 0.9 / 0.95) y su idioma de subtítulos.
- **Subtítulos inteligentes**: inglés arriba y español abajo; bajan de renglón, achican la letra si no entran y nunca se salen del video. Se arrastran, se editan con doble clic y tienen 13 estilos.
- **💾 Exportar**: guardá el video (o un fragmento con sus vueltas) con los subtítulos puestos en la imagen, en el estilo que elijas, con vista previa real. Mirá más abajo.
- **Control remoto desde el celular** (📱): escaneá el QR (misma red WiFi).
- Temas: Clásico, Harry Potter y Cómic.

## Cómo se inicia

1. Doble clic en **`iniciar.bat`** (cierra la versión anterior —solo la de esta app— y abre todo). Se abre `http://localhost:5174`.
2. La primera vez en una compu nueva, `iniciar.bat` instala solo lo que falta (puede tardar unos minutos). Si preferís hacerlo a mano:
   ```
   pip install -r backend\requirements.txt
   cd frontend && npm install
   ```
   También hace falta **ffmpeg con libass** en el PATH (la versión *full* de https://www.gyan.dev/ffmpeg/builds/).

Los videos y todo lo que genera la app viven en `D:\VideosIngles`; si la compu no tiene disco `D:`, en la carpeta `videos` al lado del programa (se cambia con la variable de entorno `LISTENING_VIDEOS_DIR`):

| Carpeta | Qué guarda |
|---|---|
| `D:\VideosIngles\*.mp4` | tus videos |
| `.subtitles\`, `.segments\` | subtítulos y fragmentos de cada video |
| `.vocabulario.json` | tus palabras guardadas y cuándo toca repasar cada una |
| **`Exportados\`** | los videos que guardás con subtítulos |

## Mis palabras: vocabulario y repaso

1. **Guardar**: en el reproductor, tocá una palabra del subtítulo en inglés. El video se pausa y aparece su traducción; podés elegir otro significado o escribir el tuyo y apretar **⭐ Guardar** (o Enter). Al cerrar, el video sigue solo. 🔊 dice la palabra en voz alta. Un clic afuera o `Esc` cierra la ventanita. Arrastrar el subtítulo y el doble clic para editarlo siguen funcionando igual.
   Si volvés a guardar la misma palabra en otra frase, se suma como un ejemplo más (se repasa con frases distintas).
2. **Repasar**: en la pantalla inicial, **📚 Mis palabras** muestra cuántas tenés y cuántas tocan hoy. Cada tarjeta reproduce la frase del video donde la escuchaste (sin subtítulos) y te muestra la palabra: intentá acordarte de qué significa y apretá *Mostrar respuesta*. Después marcá cómo te fue y la tarjeta vuelve a aparecer más tarde o más temprano:
   **Otra vez** (10 min) · **Difícil** · **Bien** (1 día, 3, 7, 14, 30… días) · **Fácil** (salta más).
   Teclas: `Espacio` muestra la respuesta (y después marca *Bien*), `1`-`4` marcan, `R` repite el audio, `Esc` sale. 🐢 *Lento* la reproduce a 0.75x. Se repasa de a 20 por tanda.
3. **Administrar**: en *Mis palabras* podés buscar, corregir una traducción, ver las frases de cada palabra y borrarla.

Solo funciona desde la compu donde corre el programa. La traducción de cada palabra la da Google (hace falta internet); si no está, igual podés escribirla vos.

## Guardar el video con subtítulos

Botón **💾 Exportar** (arriba) o **⬇️ Bajar** en un fragmento.

- **Subtítulos en la imagen**: se ven en cualquier reproductor y en el celular. Elegís idiomas, estilo y calidad (alta / media / liviana 720p). Usa tu placa NVIDIA si anda; si no, la CPU.
- **Pistas que se activan y desactivan**: no recodifica (rapidísimo); se ven en VLC y similares.
- **Fragmento**: respeta las vueltas configuradas (velocidad e idioma de cada una) y corta con precisión.
- Se guarda en `Exportados\` y además podés usar *Guardar como…* para elegir otro lugar. En la pantalla inicial está la lista de todo lo exportado.

## Atajos

`Espacio` pausa/sigue · `←` `→` retroceden/adelantan (los segundos se ajustan) · `T` lupa de la línea de tiempo · `P` modo puntero · `R` franja negra para tapar los subtítulos que ya trae el video (se arrastra y se agranda desde la esquina; se recuerda por video).

## Si algo falla

- **"Google está limitando las solicitudes"** al traducir: pasa si se traduce demasiado seguido. Esperá unos minutos y reintentá; lo ya traducido no se pierde.
- **Al tocar una palabra dice que falta reiniciar el programa**: cerrá y volvé a abrir `iniciar.bat` (el backend no toma cambios solo).
- **Al tocar una palabra no trae la traducción**: sin internet o con Google limitando solicitudes; esperá un rato o escribí la traducción a mano y guardala igual.
- **YouTube no deja bajar un video** ("no sos un robot", "no se pudo traer"…): YouTube cambia seguido y `yt-dlp` se tiene que mantener al día. Probá `pip install -U yt-dlp` y reintentá. Los videos privados, con edad restringida, solo para miembros o en vivo no se pueden traer.
- **"Tu ffmpeg no incluye libass"**: instalá la versión *full* de ffmpeg.
- **Se queda "En cola"**: las transcripciones y exportaciones corren de a una por vez.
- Para que el backend tome cambios de código hay que volver a abrir `iniciar.bat`.

## Pruebas

```
cd backend
python -m unittest discover -s tests
```
