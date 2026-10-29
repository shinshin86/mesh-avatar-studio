/* SIGWINCH and ioctl are BSD extensions outside strict POSIX. */
#define _DEFAULT_SOURCE
#define _DARWIN_C_SOURCE
#include "mesh_avatar_render.h"
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <time.h>
#include <unistd.h>

#define CHECK(call) do { \
  MaStatus status_ = (call); \
  if (status_ != MA_OK) { \
    fprintf(stderr, "%s: %d: %s\n", #call, status_, mesh_avatar_last_error()); \
    goto cleanup; \
  } \
} while (0)

/* Pixels with less coverage than this show the terminal background. */
#define ALPHA_CUTOFF 96
#define FPS 30.0

static volatile sig_atomic_t quit = 0;
static volatile sig_atomic_t resized = 0;
static void on_quit(int signal) { (void)signal; quit = 1; }
static void on_resize(int signal) { (void)signal; resized = 1; }

typedef struct { double at; const char *motion; const char *kana; } Step;
static const Step script[] = {
  {0.5, "greet", "こんにちは"},
  {4.0, "nod", NULL},
  {6.5, NULL, "めっしゅあばたーです"},
  {9.5, "sway", NULL},
};
#define SCRIPT_LENGTH 13.0

/* One cell per pixel column, two pixel rows per text row; keep the last row for a caption. */
static void terminal_pixels(uint32_t *width, uint32_t *height) {
  struct winsize size;
  unsigned cols = 80, rows = 24;
  if (ioctl(STDOUT_FILENO, TIOCGWINSZ, &size) == 0 && size.ws_col && size.ws_row) {
    cols = size.ws_col;
    rows = size.ws_row;
  } else if (getenv("COLUMNS") && getenv("LINES")) {
    cols = (unsigned)strtoul(getenv("COLUMNS"), NULL, 10);
    rows = (unsigned)strtoul(getenv("LINES"), NULL, 10);
    if (cols < 1 || cols > 1000) cols = 80;
    if (rows < 3 || rows > 500) rows = 24;
  }
  *width = cols;
  *height = rows > 2 ? (rows - 1) * 2 : 2;
}

typedef struct { char *data; size_t length, capacity; } Text;
static int append(Text *text, const char *bytes, size_t length) {
  if (text->length + length > text->capacity) {
    size_t capacity = text->capacity ? text->capacity : 1 << 16;
    while (capacity < text->length + length) capacity *= 2;
    char *data = realloc(text->data, capacity);
    if (!data) return 0;
    text->data = data;
    text->capacity = capacity;
  }
  memcpy(text->data + text->length, bytes, length);
  text->length += length;
  return 1;
}

/* Upper half block: foreground paints the top pixel, background the bottom one. */
static int draw(Text *text, const uint8_t *rgba, uint32_t width, uint32_t height, const char *caption) {
  char sgr[64];
  text->length = 0;
  if (!append(text, "\x1b[H", 3)) return 0;
  for (uint32_t y = 0; y + 1 < height; y += 2) {
    long fg = -2, bg = -2;
    for (uint32_t x = 0; x < width; ++x) {
      const uint8_t *top = rgba + ((size_t)y * width + x) * 4;
      const uint8_t *bottom = top + (size_t)width * 4;
      long t = top[3] >= ALPHA_CUTOFF ? (long)top[0] << 16 | top[1] << 8 | top[2] : -1;
      long b = bottom[3] >= ALPHA_CUTOFF ? (long)bottom[0] << 16 | bottom[1] << 8 | bottom[2] : -1;
      const char *glyph = "\xe2\x96\x80";
      if (t < 0 && b < 0) glyph = " ";
      else if (t < 0) { glyph = "\xe2\x96\x84"; t = b; b = -1; }
      int n = 0;
      if (t >= 0 && t != fg) {
        n += snprintf(sgr + n, sizeof sgr - n, "\x1b[38;2;%ld;%ld;%ldm", t >> 16, t >> 8 & 255, t & 255);
        fg = t;
      }
      if (b != bg) {
        n += b < 0 ? snprintf(sgr + n, sizeof sgr - n, "\x1b[49m")
                   : snprintf(sgr + n, sizeof sgr - n, "\x1b[48;2;%ld;%ld;%ldm", b >> 16, b >> 8 & 255, b & 255);
        bg = b;
      }
      if (!append(text, sgr, (size_t)n) || !append(text, glyph, strlen(glyph))) return 0;
    }
    if (!append(text, "\x1b[0m\r\n", 6)) return 0;
  }
  return append(text, "\x1b[2m", 4) && append(text, caption, strlen(caption)) &&
         append(text, "\x1b[0m\x1b[K", 7);
}

static double now(void) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return (double)t.tv_sec + (double)t.tv_nsec / 1e9;
}

int main(int argc, char **argv) {
  const char *source = argc > 1 ? argv[1] : "../samples/miko-qipao";
  /* Without a frame count, animate until Ctrl+C. With one, simulate that many frames at a
   * fixed step and print only the last frame, e.g. to save a still with `> frame.txt`. */
  long frames = argc > 2 ? strtol(argv[2], NULL, 10) : 0;
  int interactive = frames == 0;
  MaHandle avatar = 0;
  MaRenderer renderer = 0;
  MaAvatarInfo info;
  uint8_t *rgba = NULL;
  Text text = {0};
  int result = EXIT_FAILURE;
  CHECK(mesh_avatar_open_path(source, &avatar));
  CHECK(mesh_avatar_tick(avatar, 1.0 / FPS));
  CHECK(mesh_avatar_get_info(avatar, &info));
  uint32_t width, height;
  terminal_pixels(&width, &height);
  /* A little extra headroom keeps tilted hair inside the first text row. */
  MaRenderOptions options = {width, height, 4, MA_FIT_CONTAIN, info.pad_top + 0.06, info.pad_side};
  MaStatus status = mesh_avatar_renderer_create(avatar, &options, &renderer);
  if (status == MA_GPU_UNAVAILABLE) {
    fprintf(stderr, "SKIP: %s\n", mesh_avatar_last_error());
    result = EXIT_SUCCESS;
    goto cleanup;
  }
  CHECK(status);
  size_t length = (size_t)width * height * 4;
  if (!(rgba = malloc(length))) { fputs("Allocation failed\n", stderr); goto cleanup; }

  signal(SIGINT, on_quit);
  signal(SIGTERM, on_quit);
  signal(SIGWINCH, on_resize);
  if (interactive) fputs("\x1b[?1049h\x1b[?25l\x1b[2J", stdout);
  char caption[128];
  double start = now(), last = start;
  size_t next_step = 0;
  long last_cycle = 0;
  for (long frame = 0; !quit && (frames == 0 || frame < frames); ++frame) {
    if (resized) {
      resized = 0;
      terminal_pixels(&width, &height);
      CHECK(mesh_avatar_renderer_resize(renderer, width, height));
      length = (size_t)width * height * 4;
      uint8_t *grown = realloc(rgba, length);
      if (!grown) { fputs("Allocation failed\n", stderr); goto cleanup; }
      rgba = grown;
      fputs("\x1b[2J", stdout);
    }
    double t = now(), dt = frames ? 1.0 / FPS : t - last;
    last = t;
    double elapsed = frames ? frame / FPS : t - start;
    long cycle = (long)(elapsed / SCRIPT_LENGTH);
    if (cycle != last_cycle) { last_cycle = cycle; next_step = 0; }
    double loop_time = elapsed - SCRIPT_LENGTH * (double)cycle;
    while (next_step < sizeof script / sizeof *script && loop_time >= script[next_step].at) {
      const Step *step = &script[next_step++];
      if (step->motion) CHECK(mesh_avatar_play(avatar, step->motion));
      if (step->kana) CHECK(mesh_avatar_speak_kana(avatar, step->kana, 0, 0));
    }
    CHECK(mesh_avatar_tick(avatar, dt));
    CHECK(mesh_avatar_renderer_render(renderer, rgba, length, MA_RGBA_STRAIGHT));
    snprintf(caption, sizeof caption, " mesh-avatar %s · C ABI → RGBA → terminal · %ux%u px · Ctrl+C to quit",
             mesh_avatar_version(), width, height);
    if (!draw(&text, rgba, width, height, caption)) { fputs("Allocation failed\n", stderr); goto cleanup; }
    if (interactive) {
      fwrite(text.data, 1, text.length, stdout);
      fflush(stdout);
      double wait = 1.0 / FPS - (now() - t);
      if (wait > 0) nanosleep(&(struct timespec){0, (long)(wait * 1e9)}, NULL);
    }
  }
  if (!interactive) {
    fwrite(text.data + 3, 1, text.length - 3, stdout); /* skip the cursor-home sequence */
    fputs("\n", stdout);
    fprintf(stderr, "Drew %ld frames at %ux%u px (%zu bytes of terminal output per frame)\n",
            frames, width, height, text.length);
  }
  result = EXIT_SUCCESS;
cleanup:
  if (interactive) fputs("\x1b[0m\x1b[?25h\x1b[?1049l", stdout);
  free(text.data);
  free(rgba);
  if (renderer) mesh_avatar_renderer_destroy(renderer);
  if (avatar) mesh_avatar_destroy(avatar);
  return result;
}
