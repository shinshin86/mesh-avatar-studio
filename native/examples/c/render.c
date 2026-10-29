#include "mesh_avatar_render.h"
#include <stdio.h>
#include <stdlib.h>

#define CHECK(call) do { \
  MaStatus status_ = (call); \
  if (status_ != MA_OK) { \
    fprintf(stderr, "%s: %d: %s\n", #call, status_, mesh_avatar_last_error()); \
    goto cleanup; \
  } \
} while (0)

/* PPM has no alpha channel: composite the straight RGBA result over white. */
static int write_ppm(const char *path, const uint8_t *rgba, uint32_t width, uint32_t height) {
  FILE *file = fopen(path, "wb");
  if (!file) { perror(path); return 0; }
  int ok = fprintf(file, "P6\n%u %u\n255\n", width, height) > 0;
  size_t pixels = (size_t)width * height;
  for (size_t i = 0; ok && i < pixels; ++i) {
    const uint8_t *p = rgba + i * 4;
    uint8_t rgb[3];
    for (size_t c = 0; c < 3; ++c) {
      rgb[c] = (uint8_t)(((unsigned)p[c] * p[3] + 255u * (255u - p[3]) + 127u) / 255u);
    }
    ok = fwrite(rgb, 1, sizeof rgb, file) == sizeof rgb;
  }
  if (fclose(file) != 0) ok = 0;
  return ok;
}

int main(int argc, char **argv) {
  const char *source = argc > 1 ? argv[1] : "../samples/miko-qipao";
  const char *output = argc > 2 ? argv[2] : "target/ffi-render.ppm";
  MaHandle avatar = 0;
  MaRenderer renderer = 0;
  MaAvatarInfo info;
  MaFrame before, after;
  uint8_t *straight = NULL, *premultiplied = NULL;
  int result = EXIT_FAILURE;
  CHECK(mesh_avatar_open_path(source, &avatar));
  CHECK(mesh_avatar_set_auto_idle(avatar, 0));
  CHECK(mesh_avatar_set_auto_motion(avatar, 0));
  CHECK(mesh_avatar_set_expression(avatar, "smile"));
  CHECK(mesh_avatar_tick(avatar, 1.0 / 60.0));
  CHECK(mesh_avatar_get_info(avatar, &info));
  MaRenderOptions options = {257, 320, 4, MA_FIT_CONTAIN, info.pad_top, info.pad_side};
  MaStatus status = mesh_avatar_renderer_create(avatar, &options, &renderer);
  if (status == MA_GPU_UNAVAILABLE) {
    fprintf(stderr, "SKIP: %s\n", mesh_avatar_last_error());
    result = EXIT_SUCCESS;
    goto cleanup;
  }
  CHECK(status);
  size_t length = (size_t)options.width * options.height * 4;
  straight = malloc(length);
  premultiplied = malloc(length);
  if (!straight || !premultiplied) { fputs("Allocation failed\n", stderr); goto cleanup; }
  CHECK(mesh_avatar_get_frame(avatar, &before));
  CHECK(mesh_avatar_renderer_render(renderer, straight, length, MA_RGBA_STRAIGHT));
  CHECK(mesh_avatar_renderer_render(renderer, premultiplied, length, MA_RGBA_PREMULTIPLIED));
  CHECK(mesh_avatar_get_frame(avatar, &after));
  if (before.layers != after.layers) { fputs("Render replaced cached frame\n", stderr); goto cleanup; }
  size_t transparent = 0, visible = 0;
  for (size_t i = 0; i < length; i += 4) {
    unsigned alpha = straight[i + 3];
    transparent += alpha == 0;
    visible += alpha != 0;
    if (premultiplied[i + 3] != alpha) goto cleanup;
    for (size_t c = 0; c < 3; ++c) {
      int expected = (int)(((unsigned)straight[i + c] * alpha + 127u) / 255u);
      int actual = premultiplied[i + c];
      if (abs(expected - actual) > 1) { fputs("Alpha conversion mismatch\n", stderr); goto cleanup; }
    }
  }
  if (!visible || !transparent) { fputs("Missing visible/transparent pixels\n", stderr); goto cleanup; }
  if (!write_ppm(output, straight, options.width, options.height)) goto cleanup;
  CHECK(mesh_avatar_renderer_resize(renderer, 129, 160));
  CHECK(mesh_avatar_renderer_render(renderer, straight, length, MA_RGBA_STRAIGHT));
  printf("Rendered %ux%u RGBA (%zu visible, %zu transparent pixels) to %s; resize and alpha checks passed\n",
         options.width, options.height, visible, transparent, output);
  result = EXIT_SUCCESS;
cleanup:
  free(straight);
  free(premultiplied);
  if (renderer) mesh_avatar_renderer_destroy(renderer);
  if (avatar) mesh_avatar_destroy(avatar);
  return result;
}
